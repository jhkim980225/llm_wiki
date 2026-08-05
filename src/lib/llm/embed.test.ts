import { describe, it, expect, vi, afterEach } from 'vitest'
import { embed, toVectorLiteral, EMBED_DIM, embedConfig } from './embed'

afterEach(() => vi.restoreAllMocks())

const vec = (n: number) => Array.from({ length: n }, (_, i) => i / n)

describe('toVectorLiteral', () => {
  it('pgvector 리터럴 형식으로 만든다', () => {
    expect(toVectorLiteral([1, 2, 3])).toBe('[1,2,3]')
  })
})

describe('embedConfig', () => {
  it('env가 없으면 사내 Ollama 기본값', () => {
    const c = embedConfig({})
    expect(c.url).toContain('11434')
    expect(c.model).toBe('embeddinggemma')
  })
  it('env로 덮어쓴다', () => {
    const c = embedConfig({ EMBED_URL: 'http://x:1', EMBED_MODEL: 'm' })
    expect(c).toEqual({ url: 'http://x:1', model: 'm' })
  })
})

describe('embed', () => {
  it('/api/embeddings에 POST하고 벡터를 돌려준다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: vec(EMBED_DIM) }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const out = await embed('안녕', { url: 'http://x:1', model: 'm' })
    expect(out).toHaveLength(EMBED_DIM)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('http://x:1/api/embeddings')
    expect(JSON.parse(opts.body)).toEqual({ model: 'm', prompt: '안녕' })
  })

  it('HTTP 오류면 던진다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(embed('x')).rejects.toThrow(/503/)
  })

  it('차원이 다르면 던진다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embedding: vec(10) }) }))
    await expect(embed('x')).rejects.toThrow(/dim/)
  })
})
