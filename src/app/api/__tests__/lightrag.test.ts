import { describe, it, expect, beforeEach, vi } from 'vitest'

// bench 게이트·입력 검증만 본다 — 업스트림(LightRAG 서버)은 부르지 않는 경로만 테스트.
const session = vi.hoisted(() => ({ current: null as { user: { loginId: string } } | null }))
vi.mock('@/lib/auth/guard', () => ({ requireSession: vi.fn(async () => session.current) }))

import { GET, POST } from '@/app/api/lightrag/route'

const get = (view: string) => GET(new Request(`http://test/api/lightrag?view=${view}`))
const post = (body: unknown) =>
  POST(
    new Request('http://test/api/lightrag', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  )

beforeEach(() => {
  session.current = null
  delete process.env.LIGHTRAG_URL
})

describe('/api/lightrag 게이트', () => {
  it('비로그인이면 401', async () => {
    expect((await get('status')).status).toBe(401)
    expect((await post({ query: 'q', mode: 'hybrid' })).status).toBe(401)
  })

  it('bench 계정이 아니면 403', async () => {
    session.current = { user: { loginId: 'someone' } }
    expect((await get('status')).status).toBe(403)
    expect((await post({ query: 'q', mode: 'hybrid' })).status).toBe(403)
  })

  it('LIGHTRAG_URL 미설정이면 503', async () => {
    session.current = { user: { loginId: 'bench' } }
    expect((await get('status')).status).toBe(503)
  })

  it('잘못된 view면 400', async () => {
    session.current = { user: { loginId: 'bench' } }
    process.env.LIGHTRAG_URL = 'http://lightrag.test'
    expect((await get('nope')).status).toBe(400)
  })

  it('잘못된 mode·빈 질문이면 400', async () => {
    session.current = { user: { loginId: 'bench' } }
    process.env.LIGHTRAG_URL = 'http://lightrag.test'
    expect((await post({ query: 'q', mode: 'nope' })).status).toBe(400)
    expect((await post({ query: '', mode: 'hybrid' })).status).toBe(400)
  })
})
