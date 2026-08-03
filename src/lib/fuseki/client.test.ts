import { describe, it, expect, vi, afterEach } from 'vitest'
import { escapeLiteral, searchEntities, fusekiHealth } from './client'

afterEach(() => vi.unstubAllGlobals())

describe('escapeLiteral', () => {
  it('역슬래시·따옴표·개행을 이스케이프한다', () => {
    expect(escapeLiteral('a"b\\c\nd')).toBe('a\\"b\\\\c\\nd')
  })

  it('SPARQL 인젝션 시도를 문자열 안에 가둔다', () => {
    const evil = '" } INSERT DATA { <a> <b> "'
    const escaped = escapeLiteral(evil)
    // 리터럴을 조기 종료시킬 수 있는 것은 이스케이프되지 않은 따옴표뿐이다.
    expect(escaped.match(/(?<!\\)"/g)).toBeNull()
  })
})

const bindings = {
  results: {
    bindings: [
      {
        s: { value: 'urn:node:acme' },
        sl: { value: 'Acme' },
        p: { value: 'urn:weknora:rel:거래' },
        o: { value: 'urn:node:beta' },
        ol: { value: 'Beta' },
      },
    ],
  },
}

describe('searchEntities', () => {
  it('바인딩을 노드와 엣지로 바꾼다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(bindings), { status: 200 })),
    )
    const r = await searchEntities(['Acme'])
    expect(r.nodes).toEqual([
      { uri: 'urn:node:acme', label: 'Acme' },
      { uri: 'urn:node:beta', label: 'Beta' },
    ])
    expect(r.edges).toEqual([
      { source: 'urn:node:acme', target: 'urn:node:beta', relation: '거래' },
    ])
  })

  it('라벨이 없으면 요청을 보내지 않는다', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await searchEntities([])).toEqual({ nodes: [], edges: [] })
    expect(spy).not.toHaveBeenCalled()
  })

  it('검색어를 이스케이프해서 질의에 넣는다', async () => {
    const spy = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify(bindings), { status: 200 }),
    )
    vi.stubGlobal('fetch', spy)
    await searchEntities(['a"b'])
    expect(String(spy.mock.calls[0][1].body)).toContain('a\\"b')
  })

  it('Fuseki가 죽으면 던진다 (호출자가 degrade 판단)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    )
    await expect(searchEntities(['Acme'])).rejects.toThrow(/500/)
  })
})

describe('fusekiHealth', () => {
  it('연결 실패를 던지지 않고 false로 돌려준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )
    expect(await fusekiHealth()).toBe(false)
  })
})
