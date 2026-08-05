import { NextResponse } from 'next/server'
import { extractTerms, retrieve, writeDocStream, splitDoc } from '@/lib/rag/compose'

/** 리터럴 스캔 + LLM 두 번. 넉넉히 준다. */
export const maxDuration = 600

const MAX_REQUEST = 2000

/**
 * 그래프 RAG — 요청 하나로 그래프를 뒤져 위키 문서를 쓴다.
 *
 * body: { request: string }
 * 응답: NDJSON 스트림. 한 줄에 이벤트 하나.
 *   {"stage":"terms","terms":[...]}
 *   {"stage":"graph","graph":{...},"evidence":[...]}
 *   {"stage":"delta","text":"…"}          ← 작성 중 토큰
 *   {"stage":"done","draft":{...}}
 *   {"stage":"error","error":"…"}
 *
 * 작성 단계가 전체의 대부분이라(실측 220초 중 210초) 다 끝나고 주면 화면이 몇 분간
 * 비어 있다. 그래서 단계마다 흘려보낸다. 저장은 하지 않는다 — 사람이 보고 정한다.
 */
export async function POST(req: Request) {
  const body = await req.json()
  const request: unknown = body?.request

  if (typeof request !== 'string' || !request.trim()) {
    return NextResponse.json({ error: 'request is required' }, { status: 400 })
  }
  if (request.length > MAX_REQUEST) {
    return NextResponse.json({ error: 'request too long' }, { status: 400 })
  }
  const ask = request.trim()

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + '\n'))
      try {
        const terms = await extractTerms(ask)
        send({ stage: 'terms', terms })

        const found = await retrieve(terms)
        send({ stage: 'graph', graph: found.graph, evidence: found.evidence, wiki: found.wiki })

        let text = ''
        for await (const chunk of writeDocStream(ask, found).textStream) {
          text += chunk
          send({ stage: 'delta', text: chunk })
        }
        send({ stage: 'done', draft: splitDoc(text, ask.slice(0, 60)) })
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
      // 프록시가 중간에 모아두면 스트리밍이 의미 없어진다.
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
