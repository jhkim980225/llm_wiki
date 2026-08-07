import { generateText } from 'ai'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { llmConfig, llmModel, llmProviderOptions } from '@/lib/llm/provider'
import { extractTerms, interleaveBySource } from '@/lib/rag/compose'
import { searchGraphs, type GraphResult } from '@/lib/fuseki/client'
import { attributesFor, type Attributed } from '@/lib/agent/tools'
import { askSourceRag, hasRagApi } from '@/lib/rag/source-rag'
import { QUERY_SOURCES } from '@/lib/ontology/source'
import { generateJson } from '@/lib/llm/json'

/** API 3건 + SPARQL 풀스캔 + 판정 LLM. 넉넉히. */
export const maxDuration = 600

const MAX_QUESTION = 500

/** 소스당 SPARQL 다이제스트 예산(자). 판정 LLM 컨텍스트를 지킨다. */
const DIGEST_CHARS = 4_000

/** 판정에 넘길 API 답변 상한(자). */
const ANSWER_CHARS = 3_000

const VerdictSchema = z.object({
  verdicts: z
    .array(
      z.object({
        source: z.string().describe('소스 id'),
        verdict: z.enum(['일치', '부분일치', '불일치', '판단불가']),
        reason: z.string().describe('한두 문장 근거'),
      }),
    )
    .min(1),
  summary: z.string().describe('전체 정합성 한두 문장'),
})

/** 소스 하나의 SPARQL 조회 결과를 판정 LLM이 읽을 텍스트로 편다. */
function sparqlDigest(id: string, graph: GraphResult, evidence: Attributed[]): string {
  const lines: string[] = []
  const status = graph.sources.find((s) => s.id === id)
  if (status && !status.ok) return `조회 실패 — ${status.error}`

  const nodes = graph.nodes.filter((n) => n.source === id)
  if (nodes.length > 0) {
    lines.push(`개체 ${nodes.length}건: ${nodes.slice(0, 30).map((n) => n.label || n.uri).join(', ')}`)
  }

  const byLabel = new Map(graph.nodes.map((n) => [n.uri, n.label]))
  const edges = graph.edges.filter((e) => e.from === id)
  for (const e of edges.slice(0, 30)) {
    lines.push(`- ${byLabel.get(e.source) ?? e.source} —${e.relation}→ ${byLabel.get(e.target) ?? e.target}`)
  }

  for (const h of graph.textHits.filter((t) => t.source === id).slice(0, 10)) {
    lines.push(`- [본문] ${h.label || h.uri}: ${h.snippet.replace(/\s+/g, ' ')}`)
  }

  for (const e of evidence.filter((a) => a.source === id)) {
    lines.push(`### ${e.label || e.uri}`)
    for (const a of e.attributes.slice(0, 8)) {
      lines.push(`- ${a.name}: ${a.value.replace(/\s+/g, ' ').slice(0, 300)}`)
    }
  }

  if (lines.length === 0) return '(조회 성공, 결과 없음)'
  return lines.join('\n').slice(0, DIGEST_CHARS)
}

/**
 * 정합성 검증 — 같은 질문을 (A) 소스별 전용 RAG API와 (B) 그래프 DB SPARQL 직조회에
 * 동시에 던지고, LLM이 소스별로 두 결과가 맞물리는지 판정한다. /verify 페이지 전용.
 *
 * body: { question: string }
 * 응답: NDJSON 스트림 — terms / api / sparql / verdict / error
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const question: unknown = body?.question
  if (typeof question !== 'string' || !question.trim()) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 })
  }
  if (question.length > MAX_QUESTION) {
    return NextResponse.json({ error: 'question too long' }, { status: 400 })
  }
  const q = question.trim()

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + '\n'))
      try {
        const ragSources = QUERY_SOURCES.filter((s) => hasRagApi(s.id))

        // 용어 추출은 SPARQL 경로에만 필요하다. API 경로는 질문 원문을 그대로 받는다.
        const terms = await extractTerms(q)
        send({ stage: 'terms', terms })

        // 두 경로를 동시에 태운다 — 비교가 목적이므로 같은 시점의 결과여야 공정하다.
        const t0 = Date.now()
        const [answers, graph] = await Promise.all([
          Promise.all(
            ragSources.map(async (s) => {
              const started = Date.now()
              const r = await askSourceRag(s.id, q)
              return { id: s.id, name: s.name, ms: Date.now() - started, ...r }
            }),
          ),
          searchGraphs(terms),
        ])
        send({ stage: 'api', answers })

        const targets = interleaveBySource(graph.nodes.length > 0 ? graph.nodes : graph.textHits)
        const evidence = targets.length > 0 ? await attributesFor(targets, 9) : []
        const digests = ragSources.map((s) => ({
          id: s.id,
          name: s.name,
          text: sparqlDigest(s.id, graph, evidence),
        }))
        send({
          stage: 'sparql',
          digests,
          sources: graph.sources,
          counts: { nodes: graph.nodes.length, edges: graph.edges.length, textHits: graph.textHits.length },
          queries: graph.queries,
          ms: Date.now() - t0,
        })

        // 통합 답변과 정합성 판정은 서로 독립 — 동시에 돌리고 끝나는 대로 흘려보낸다.
        const config = llmConfig()
        const mergedP = generateText({
          model: llmModel(config),
          providerOptions: llmProviderOptions(config),
          system:
            '너는 세 사내 데이터 소스의 답변을 하나로 통합한다.\n' +
            '- 중복은 합치고, 소스마다 다른 내용은 어느 소스에서 온 것인지 밝힌다.\n' +
            '- 소스 답변에 없는 내용은 절대 추가하지 마라. 셋 다 없는 것은 "확인되지 않음"으로 적는다.\n' +
            '- 간결한 마크다운으로 쓴다.',
          prompt: [
            `질문: ${q}`,
            '',
            ...answers.map((a) =>
              `## ${a.name}\n${a.ok ? (a.answer ?? '').slice(0, ANSWER_CHARS) : `(조회 실패 — ${a.error})`}`,
            ),
          ].join('\n'),
        }).then((r) => send({ stage: 'merged', answer: r.text }))

        const judgedP = generateJson({
          schema: VerdictSchema,
          system:
            '너는 데이터 정합성 심판이다. 같은 질문에 대해 소스별로 (A) 전용 RAG API의 자연어 답변과 ' +
            '(B) 같은 그래프 DB를 SPARQL로 직접 조회한 결과를 비교해 판정한다.\n' +
            '- 일치: A의 핵심 사실이 B에서 확인된다\n' +
            '- 부분일치: 일부만 겹치고 나머지는 B에 없다\n' +
            '- 불일치: A와 B가 서로 모순된다 (없는 것과 모순은 다르다!)\n' +
            '- 판단불가: 한쪽이 실패했거나 비어 있어 비교할 수 없다\n' +
            'B는 추출된 용어로 검색한 원시 개체·관계 목록이라 A보다 좁을 수 있다. ' +
            'B에 없다는 이유만으로 불일치로 판정하지 마라 — 모순이 있을 때만 불일치다.\n' +
            '형식: {"verdicts":[{"source":"소스id","verdict":"일치|부분일치|불일치|판단불가","reason":"한두 문장"}],"summary":"전체 한두 문장"}',
          prompt: [
            `질문: ${q}`,
            '',
            ...ragSources.flatMap((s) => {
              const a = answers.find((x) => x.id === s.id)
              const d = digests.find((x) => x.id === s.id)
              return [
                `## 소스 ${s.id} (${s.name})`,
                `### A. RAG API 답변`,
                a?.ok ? (a.answer ?? '').slice(0, ANSWER_CHARS) : `API 실패 — ${a?.error}`,
                `### B. SPARQL 직조회`,
                d?.text ?? '(없음)',
                '',
              ]
            }),
          ].join('\n'),
        }).then((judged) => send({ stage: 'verdict', ...judged }))

        await Promise.all([mergedP, judgedP])
      } catch (e) {
        send({ stage: 'error', error: (e as Error).message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
