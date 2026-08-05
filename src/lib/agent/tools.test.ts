import { describe, it, expect, vi, afterEach } from 'vitest'
import { budgetContent, READ_BUDGET, wikiTools } from './tools'
import { QUERY_SOURCES } from '@/lib/ontology/source'

/** 도구는 AI SDK가 감싼 형태라 execute를 직접 부른다. */
type GraphAnswer = {
  nodes: unknown[]
  textHits: unknown[]
  sources: { id: string; ok: boolean; searchedText?: boolean; error?: string }[]
}

const callGraph = (args: { labels: string[]; withAttributes: boolean }) =>
  (wikiTools.query_knowledge_graph.execute as unknown as (
    a: typeof args,
    o: unknown,
  ) => Promise<GraphAnswer>)(args, {})

describe('budgetContent', () => {
  it('예산 안이면 그대로', () => {
    expect(budgetContent('짧음')).toEqual({ text: '짧음', truncated: false })
  })

  it('예산을 넘으면 자르고 잘렸다고 알린다', () => {
    const long = 'a'.repeat(READ_BUDGET + 100)
    const r = budgetContent(long)
    expect(r.truncated).toBe(true)
    expect(r.text.length).toBeLessThanOrEqual(READ_BUDGET + 64)
    expect(r.text).toContain('잘렸습니다')
  })

  it('정확히 예산 크기면 자르지 않는다', () => {
    expect(budgetContent('a'.repeat(READ_BUDGET)).truncated).toBe(false)
  })
})

describe('query_knowledge_graph', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('물려 있는 그래프 3개를 한 번에 친다', async () => {
    expect(QUERY_SOURCES.map((s) => s.id)).toEqual(['ejkim', 'kakao', 'seunghoon'])

    const spy = vi.fn(async () => new Response(JSON.stringify({ results: { bindings: [] } })))
    vi.stubGlobal('fetch', spy)

    const r = await callGraph({ labels: ['성진'], withAttributes: false })

    expect(r.sources.map((s) => s.id)).toEqual(QUERY_SOURCES.map((s) => s.id))
    // 라벨 검색이 빈손이라 소스마다 리터럴 검색까지 간다 (소스당 2회).
    expect(spy).toHaveBeenCalledTimes(QUERY_SOURCES.length * 2)
  })

  // 비싼 경로다 — 실측 ejkim 13초. 라벨로 찾았으면 갈 이유가 없다.
  it('라벨로 찾으면 리터럴 검색은 건너뛴다', async () => {
    const hit = {
      results: {
        bindings: [
          {
            s: { type: 'uri', value: 'urn:a' },
            sl: { type: 'literal', value: '성진' },
            p: { type: 'uri', value: 'urn:ejkim:ontology:거래' },
            o: { type: 'uri', value: 'urn:b' },
            ol: { type: 'literal', value: '성진물산' },
          },
        ],
      },
    }
    const spy = vi.fn(async () => new Response(JSON.stringify(hit)))
    vi.stubGlobal('fetch', spy)

    const r = await callGraph({ labels: ['성진'], withAttributes: false })

    expect(spy).toHaveBeenCalledTimes(QUERY_SOURCES.length)
    expect(r.sources.every((s) => s.searchedText === false)).toBe(true)
  })

  // Fuseki가 다 죽어도 대화는 계속돼야 한다. 그리고 "못 찾음"과 "못 물어봄"은
  // 구분돼야 한다 — 빈 결과만 주면 LLM이 "그런 사실 없음"으로 단정한다.
  it('소스가 전부 죽어도 던지지 않고 어느 소스가 실패했는지 알려준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )

    const r = await callGraph({ labels: ['성진'], withAttributes: true })

    expect(r.nodes).toEqual([])
    expect(r.sources).toHaveLength(QUERY_SOURCES.length)
    expect(r.sources.every((s) => !s.ok)).toBe(true)
    expect(r.sources[0].error).toContain('ECONNREFUSED')
  })
})
