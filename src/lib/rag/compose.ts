import { streamText } from 'ai'
import { z } from 'zod'
import { searchGraphs, type GraphResult } from '@/lib/fuseki/client'
import { QUERY_SOURCES } from '@/lib/ontology/source'
import { attributesFor, type Attributed } from '@/lib/agent/tools'
import { generateJson } from '@/lib/llm/json'
import { llmConfig, llmModel, llmProviderOptions } from '@/lib/llm/provider'
import { normalizeSlug } from '@/lib/wiki/slug'
import { createOrRevivePage, savePage } from '@/lib/pages/save'
import { db } from '@/lib/db'

/**
 * 그래프 RAG — 질문 하나로 그래프 3개를 뒤져 위키 문서 한 장을 쓴다.
 *
 * 채팅 도우미와 다른 점은 순서가 고정이라는 것이다. 채팅은 LLM이 매번 어떤 도구를
 * 어떤 순서로 부를지 정해서 같은 질문에도 다르게 답한다. 여기는 늘 같은 길을 간다:
 *   용어 추출 → 3소스 조회 → 근거 수집 → 작성
 */

/** 근거로 넘길 개체 수. qwen3 컨텍스트가 32k라 본문 리터럴을 무제한 못 싣는다. */
const EVIDENCE_NODES = 6

/** 개체 하나당 속성 값 길이 상한. 문서 전문이 통째로 들어오면 컨텍스트가 터진다. */
const VALUE_CHARS = 1200

/**
 * 근거 전체 길이 상한.
 *
 * 개체마다 자르는 것만으로는 부족하다 — extractedText를 가진 문서 개체가 몇 개만 걸려도
 * 실측 88,901자가 나왔고, 그 상태로 작성 단계에 넘기면 컨텍스트(32k 토큰)를 넘겨
 * 응답이 돌아오지 않는다. 한국어는 대략 1.5자/토큰이라 이만큼이 안전선이다.
 */
const EVIDENCE_CHARS = 12_000

/** 위키 근거 발췌 전체 예산. 그래프 근거(12,000자)와 별도로 잡는다. */
const WIKI_CHARS = 3_600

/** 용어당 위키 문서 수 상한. */
const WIKI_PER_TERM = 3

export type WikiHit = {
  slug: string
  title: string
  summary: string
  snippet: string
  lastEditSource: string
}

/**
 * 용어가 제목·요약·본문에 나오는 위키 문서를 찾는다. 그래프에 없는 내용이라도
 * 사람이 직접 쓴 문서가 근거가 되도록 — 온톨로지 적재본은 그래프 조회와 겹치므로
 * 사람(user)·에이전트(agent) 문서를 앞에 세운다.
 *
 * 발췌는 매칭 지점 앞뒤로 자른다. 문서 전문을 실으면 컨텍스트가 터진다.
 */
async function searchWiki(terms: string[]): Promise<WikiHit[]> {
  // 용어마다 content 풀스캔이라 한 건이 수백 ms다. 서로 독립이므로 동시에 던지고
  // (순차면 용어 수만큼 곱해진다), 합칠 때 용어 순서대로 dedup해 우선순위를 유지한다.
  const perTerm = await Promise.all(
    terms.map(
      (term) => db.$queryRaw<WikiHit[]>`
      SELECT slug, title, summary, "lastEditSource",
             substr(content,
                    greatest(1, position(${term} IN content) - 200),
                    600) AS snippet
      FROM "Page"
      WHERE "deletedAt" IS NULL
        AND (position(${term} IN title) > 0
          OR position(${term} IN summary) > 0
          OR position(${term} IN content) > 0)
      ORDER BY
        CASE WHEN "lastEditSource" = 'ontology' THEN 1 ELSE 0 END,
        CASE
          WHEN title = ${term} THEN 0
          WHEN position(${term} IN title) > 0 THEN 1
          WHEN position(${term} IN summary) > 0 THEN 2
          ELSE 3
        END,
        char_length(title)
      LIMIT ${WIKI_PER_TERM}`,
    ),
  )
  const seen = new Map<string, WikiHit>()
  for (const rows of perTerm) for (const r of rows) if (!seen.has(r.slug)) seen.set(r.slug, r)
  return [...seen.values()]
}

const TermsSchema = z.object({
  terms: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe('그래프에서 찾을 핵심 용어. 고유명사·물질명 위주로, 조사와 수식어는 뺀다.'),
})

export type ComposeResult = {
  terms: string[]
  graph: GraphResult
  evidence: Attributed[]
  draft: Draft
  saved?: { slug: string; version: number }
}

/** 1단계 — 요청에서 검색어를 뽑는다. */
export async function extractTerms(request: string): Promise<string[]> {
  const { terms } = await generateJson({
    schema: TermsSchema,
    system:
      '너는 지식 그래프 검색어를 뽑는다. 사용자 요청에서 그래프에 실제로 개체나 문서로 ' +
      '존재할 만한 말만 고른다.\n' +
      '- 물질명·제품명·회사명·사람 이름처럼 구체적인 것만 넣는다.\n' +
      '- "제품", "문서", "자료", "내용", "정보" 같은 일반 명사는 절대 넣지 마라. ' +
      '아무 데나 걸려서 검색을 망친다.\n' +
      '- 동사와 조사도 뺀다. 고를 것이 하나뿐이면 하나만 넣는다.\n' +
      '형식: {"terms": ["검색어1", "검색어2"]}',
    prompt: request,
  })
  return terms
}

/**
 * 근거 개체 중 **위키에 실제로 문서로 있는 것**의 slug를 찾는다.
 *
 * 적재가 `{소스}/{정규화한 라벨}`로 slug를 만들지만 이름이 겹치면 `-2`가 붙는다.
 * 그래서 계산한 slug를 그대로 믿지 않고 DB에 있는 것만 고른다 —
 * 없는 문서로 링크를 걸면 본문에 죽은 링크만 늘어난다.
 */
async function resolveLinks(
  items: { label: string; source: string }[],
): Promise<Map<string, string>> {
  const wanted = new Map<string, string>()
  for (const it of items) {
    if (!it.label) continue
    const base = normalizeSlug(it.label)
    if (base) wanted.set(`${it.source}/${base}`, it.label)
  }
  if (wanted.size === 0) return new Map()

  const found = await db.page.findMany({
    where: { slug: { in: [...wanted.keys()] }, deletedAt: null },
    select: { slug: true },
  })
  // 라벨 → slug. 본문에서 이름으로 찾아 쓰기 편하다.
  return new Map(found.map((p) => [wanted.get(p.slug) as string, p.slug]))
}

/** 근거를 LLM이 읽을 수 있는 텍스트로 편다. */
function renderEvidence(
  graph: GraphResult,
  evidence: Attributed[],
  links: Map<string, string>,
  wiki: WikiHit[] = [],
): string {
  const lines: string[] = []

  if (wiki.length > 0) {
    lines.push('## 위키 문서에서 찾은 것 (사내 위키에 이미 적힌 내용이다)')
    const budget = Math.max(400, Math.floor(WIKI_CHARS / wiki.length))
    for (const h of wiki) {
      const snip = h.snippet.replace(/\s+/g, ' ').slice(0, budget)
      lines.push(`- [[${h.slug}|${h.title}]]${h.summary ? ` — ${h.summary}` : ''}: ${snip}`)
    }
    lines.push('')
  }

  lines.push('## 조회한 그래프')
  for (const s of graph.sources) {
    lines.push(
      s.ok
        ? `- ${s.name}(${s.id}): 조회 성공${s.searchedText ? ' (이름으로 못 찾아 본문까지 검색)' : ''}`
        : `- ${s.name}(${s.id}): **조회 실패** — ${s.error}. 여기 내용은 확인하지 못했다.`,
    )
  }

  if (graph.edges.length > 0) {
    lines.push('', '## 관계')
    const byLabel = new Map(graph.nodes.map((n) => [n.uri, n.label]))
    for (const e of graph.edges.slice(0, 60)) {
      lines.push(
        `- [${e.from}] ${byLabel.get(e.source) ?? e.source} —${e.relation}→ ${byLabel.get(e.target) ?? e.target}`,
      )
    }
  }

  if (graph.textHits.length > 0) {
    lines.push('', '## 본문에서 찾은 곳')
    for (const h of graph.textHits.slice(0, 20)) {
      lines.push(`- [${h.source}] ${h.label || h.uri} (${h.predicate}): ${h.snippet.replace(/\s+/g, ' ')}`)
    }
  }

  if (links.size > 0) {
    lines.push('', '## 위키에 문서가 있는 것 (참고란에 이 줄을 그대로 옮겨라)')
    for (const [label, slug] of links) lines.push(`- [[${slug}|${label}]]`)
  }

  if (evidence.length > 0) {
    lines.push('', '## 개체 상세')

    // 전체 예산을 지키며 담는다. 개체를 고르게 보여주려고 개체당 몫을 나눠 준다 —
    // 앞의 하나가 예산을 다 먹으면 나머지 소스의 근거가 통째로 사라진다.
    const budget = Math.max(600, Math.floor(EVIDENCE_CHARS / evidence.length))

    for (const e of evidence) {
      lines.push('', `### [${e.source}] ${e.label || e.uri}`)
      let used = 0
      for (const a of e.attributes) {
        if (used >= budget) {
          lines.push('- …(이하 생략)')
          break
        }
        const room = Math.min(VALUE_CHARS, budget - used)
        const value = a.value.replace(/\s+/g, ' ')
        lines.push(`- ${a.name}: ${value.slice(0, room)}${value.length > room ? '…' : ''}`)
        used += Math.min(value.length, room)
      }
    }
  }

  return lines.join('\n')
}

/** 2·3단계 — 그래프 3소스와 **위키 문서**를 나란히 뒤지고 근거를 모은다. */
export async function retrieve(terms: string[]): Promise<Retrieved> {
  // 위키 검색은 Postgres 한 방이라 그래프 왕복과 겹쳐 돌려도 공짜다.
  const [graph, wiki] = await Promise.all([searchGraphs(terms), searchWiki(terms)])
  const targets = graph.nodes.length > 0 ? graph.nodes : graph.textHits
  const evidence = targets.length > 0 ? await attributesFor(targets, EVIDENCE_NODES) : []
  const links = await resolveLinks([...evidence, ...graph.textHits])
  // 위키 히트는 slug를 이미 아니 그대로 링크에 얹는다.
  for (const h of wiki) if (!links.has(h.title)) links.set(h.title, h.slug)
  return { graph, wiki, evidence, links }
}

export type Retrieved = {
  graph: GraphResult
  /** 질문 용어가 제목·요약·본문에 나오는 위키 문서 발췌. */
  wiki: WikiHit[]
  evidence: Attributed[]
  /** 라벨 → 위키 slug. 참고란에서 [[링크]]로 걸 수 있는 것들. */
  links: Map<string, string>
}

/** 작성 단계 지시문. 스트리밍·비스트리밍이 같은 규칙을 쓴다. */
function writeSystem(graph: GraphResult, extra: string[] = []): string {
  const failed = graph.sources.filter((s) => !s.ok)
  return [
    '너는 사내 지식 그래프와 사내 위키 문서에서 모은 근거만으로 위키 문서를 쓴다.',
    '- "위키 문서에서 찾은 것"의 내용도 그래프와 같은 자격의 근거다. 쓰면 참고 절에',
    '  준 그대로 [[slug|제목]] 형태로 링크한다.',
    '',
    '- 아래 근거에 없는 내용은 절대 쓰지 마라. 모르는 것은 "확인되지 않음"이라고 적는다.',
    '- **본문에는 출처를 적지 마라.** [ejkim], [승훈 온톨로지], (출처: …) 같은 표기를',
    '  문장이나 표 안에 넣지 마라. 출처는 맨 끝 "## 참고"에만 모은다.',
    '- 마지막은 반드시 `## 참고` 절로 끝낸다. 근거로 쓴 문서를 목록으로 적고,',
    '  "위키에 문서가 있는 것"에 있는 항목은 준 그대로 [[slug|이름]] 형태로 링크한다.',
    '  링크가 없는 항목은 이름만 적고 뒤에 어느 그래프에서 왔는지 덧붙인다.',
    '- 조회하지 못한 그래프가 있으면 참고 절 끝에 한 줄로 적어라.',
    '  실패는 "그런 사실이 없다"가 아니라 "확인하지 못했다"이다. 둘을 섞지 마라.',
    '- 서로 다른 그래프의 내용이 어긋나면 어느 쪽이 무엇이라 했는지 참고 절에 적어라.',
    '- 마크다운으로 쓰고, 표가 맞으면 표를 쓴다.',
    failed.length > 0 ? `- 이번에 조회하지 못한 그래프: ${failed.map((s) => s.name).join(', ')}` : '',
    ...extra,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * 작성 단계를 토큰 단위로 흘린다.
 *
 * 이 단계가 전체 시간의 대부분이다(실측 220초 중 약 210초). 다 끝나고 한꺼번에 주면
 * 사용자는 4분 동안 빈 화면을 본다. 그래서 여기만 JSON을 쓰지 않고 마크다운을 그대로
 * 흘리고, 제목은 첫 번째 `# ` 제목줄에서 뽑는다.
 */
export function writeDocStream(
  request: string,
  { graph, wiki, evidence, links }: Retrieved,
): ReturnType<typeof streamText> {
  const config = llmConfig()
  return streamText({
    model: llmModel(config),
    providerOptions: llmProviderOptions(config),
    system: writeSystem(graph, [
      '',
      '출력은 마크다운 본문 하나다. JSON도 코드펜스도 쓰지 마라.',
      '첫 줄은 반드시 `# 문서 제목` 형식의 제목줄로 시작한다.',
    ]),
    prompt: `요청: ${request}\n\n---\n\n${renderEvidence(graph, evidence, links, wiki)}`,
  })
}

/**
 * 본문에 박힌 인라인 출처를 걷어낸다.
 *
 * 프롬프트로 "본문에 출처를 적지 마라"고 해도 모델이 지키지 않는다(실측: 지시해도
 * [ejkim]이 표 안에 그대로 남았다). 출처는 참고 절에만 있어야 하므로 여기서 지운다.
 * [[위키링크]]는 건드리지 않는다 — 대괄호가 둘이라 패턴이 다르다.
 */
export function stripInlineSources(markdown: string): string {
  const names = QUERY_SOURCES.flatMap((s) => [s.id, s.name])
  const alt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')

  return (
    markdown
      // [ejkim] · [승훈 온톨로지] — 앞뒤가 대괄호면 위키링크이므로 건너뛴다
      .replace(new RegExp(String.raw`(?<!\[)\[(?:${alt})\](?!\])`, 'g'), '')
      // (출처: …) · (출처 …)
      .replace(/\(\s*출처\s*[:：]?[^)]*\)/g, '')
      // 지우고 남은 겹친 공백을 정리한다.
      // 표의 `|` 앞뒤 공백은 건드리면 안 된다 — 칸 구분이 깨진다.
      .replace(/[^\S\n]{2,}/g, ' ')
      .replace(/[^\S\n]+([,.)])/g, '$1')
      .replace(/[^\S\n]+$/gm, '')
  )
}

/** 스트리밍으로 받은 마크다운에서 제목과 본문을 가른다. */
export function splitDoc(markdown: string, fallbackTitle: string): Draft {
  const text = stripInlineSources(markdown).trim()
  const m = text.match(/^#\s+(.+?)\s*$/m)
  const title = m?.[1]?.trim() || fallbackTitle
  const content = m ? text.slice(0, m.index).trim() + '\n' + text.slice(m.index! + m[0].length).trim() : text
  const firstLine = content.split('\n').find((l) => l.trim() && !l.startsWith('#'))
  return { title, summary: (firstLine ?? '').replace(/[*_`#>|-]/g, '').trim().slice(0, 120), content: content.trim() }
}

export type Draft = { title: string; summary: string; content: string }

/** 4단계 — 스트림을 끝까지 모아 문서 하나로 만든다. */
export async function writeDoc(request: string, found: Retrieved): Promise<Draft> {
  const stream = writeDocStream(request, found)
  let text = ''
  for await (const chunk of stream.textStream) text += chunk
  return splitDoc(text, request.slice(0, 60))
}

/**
 * 전체를 순서대로 돈다. save가 true면 위키에 저장까지 한다.
 *
 * 기본은 저장하지 않는다 — 초안을 보고 사람이 정하게 한다. LLM이 쓴 문서가
 * 조용히 위키에 쌓이면 나중에 무엇이 사람 글이고 무엇이 생성물인지 구분이 안 된다.
 */
export async function composeWikiPage(
  request: string,
  opts: { slug?: string; save?: boolean } = {},
): Promise<ComposeResult> {
  const terms = await extractTerms(request)
  const found = await retrieve(terms)
  const { graph, evidence } = found
  const draft = await writeDoc(request, found)

  if (!opts.save) return { terms, graph, evidence, draft }

  const slug = normalizeSlug(opts.slug || draft.title)
  if (!slug) throw new Error('slug is empty after normalization')

  const existing = await db.page.findFirst({ where: { slug, deletedAt: null } })
  const page = existing
    ? await savePage({
        slug,
        expectedVersion: existing.version,
        title: draft.title,
        summary: draft.summary,
        content: draft.content,
        editSource: 'agent',
      })
    : await createOrRevivePage({
        slug,
        title: draft.title,
        summary: draft.summary,
        content: draft.content,
        pageType: 'synthesis',
        editSource: 'agent',
      })

  return { terms, graph, evidence, draft, saved: { slug: page.slug, version: page.version } }
}
