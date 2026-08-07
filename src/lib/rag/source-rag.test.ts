import { describe, it, expect, vi, afterEach } from 'vitest'
import { askSourceRag, hasRagApi, ragUrl } from './source-rag'

// entities 수집(fire-and-forget)이 테스트에서 실제 DB를 물지 않게 잘라 둔다.
vi.mock('@/lib/graph-ref/store', () => ({ upsertRef: vi.fn(async () => ({})) }))

afterEach(() => vi.unstubAllGlobals())

const ok = (body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))

describe('hasRagApi / ragUrl', () => {
  it('세 소스는 전용 API를 가진다', () => {
    expect(hasRagApi('ejkim')).toBe(true)
    expect(hasRagApi('kakao')).toBe(true)
    expect(hasRagApi('seunghoon')).toBe(true)
    expect(hasRagApi('weknora')).toBe(false)
  })

  it('소스별 기본 URL', () => {
    expect(ragUrl('ejkim')).toContain(':30311/ejkim/api/rag/ask')
    expect(ragUrl('seunghoon')).toContain(':30313/api/rag/ask')
  })

  it('API 없는 소스는 던진다', () => {
    expect(() => ragUrl('weknora')).toThrow(/no RAG API/)
  })
})

describe('askSourceRag', () => {
  it('answer만 뽑아 온다 (entities 없는 응답 — 빈 배열)', async () => {
    ok({ answer: '정아라님의 6월 업무는…', timing: { total: 41465 } })
    expect(await askSourceRag('ejkim', '질문')).toEqual({
      ok: true,
      answer: '정아라님의 6월 업무는…',
      entities: [],
    })
  })

  it('entities를 걸러서 담는다 — 문장 조각은 버린다', async () => {
    ok({
      answer: '성진의 발주 목록은…',
      entities: [
        { name: '주식회사 성진', type: 'organization' },
        { name: '라 한다)과 주식회사 성진', type: 'organization' },
      ],
    })
    const r = await askSourceRag('seunghoon', '질문')
    expect(r.entities).toEqual([{ name: '주식회사 성진', type: 'organization' }])
  })

  it('요청 body는 { question }', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _opts: RequestInit) =>
        new Response(JSON.stringify({ answer: 'x' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await askSourceRag('seunghoon', '성진이 발주낸거 목록 알려 줘')
    const opts = fetchMock.mock.calls[0][1]
    expect(JSON.parse(opts.body as string)).toEqual({ question: '성진이 발주낸거 목록 알려 줘' })
  })

  it('HTTP 오류는 ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 502 })))
    expect(await askSourceRag('kakao', '질문')).toEqual({ ok: false, error: 'HTTP 502' })
  })

  it('answer가 없으면 실패', async () => {
    ok({ timing: {} })
    expect((await askSourceRag('ejkim', '질문')).ok).toBe(false)
  })

  it('네트워크 오류는 던지지 않고 ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('fetch failed'))))
    expect(await askSourceRag('seunghoon', '질문')).toEqual({ ok: false, error: 'fetch failed' })
  })
})
