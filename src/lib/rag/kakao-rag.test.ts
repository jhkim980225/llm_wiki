import { describe, it, expect, vi, afterEach } from 'vitest'
import { askKakaoRag } from './kakao-rag'

afterEach(() => vi.unstubAllGlobals())

const ok = (body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))

describe('askKakaoRag', () => {
  it('answer만 뽑아 온다', async () => {
    ok({ answer: '정아라님의 6월 업무는…', timing: { total: 41465 } })
    expect(await askKakaoRag('질문')).toEqual({
      ok: true,
      answer: '정아라님의 6월 업무는…',
      entities: [],
    })
  })

  it('HTTP 오류는 ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 502 })))
    expect(await askKakaoRag('질문')).toEqual({ ok: false, error: 'HTTP 502' })
  })

  it('answer가 없으면 실패로 친다', async () => {
    ok({ timing: {} })
    const r = await askKakaoRag('질문')
    expect(r.ok).toBe(false)
  })

  it('네트워크 오류는 던지지 않고 ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('fetch failed'))))
    expect(await askKakaoRag('질문')).toEqual({ ok: false, error: 'fetch failed' })
  })
})
