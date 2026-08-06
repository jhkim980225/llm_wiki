import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  escapeLiteral,
  searchEntities,
  searchGraphs,
  searchText,
  fusekiHealth,
  resetBreaker,
  rankByTermMatches,
  type EntityNode,
} from './client'
import { RDFS_LABEL, type OntologySource } from '@/lib/ontology/source'

afterEach(() => {
  vi.unstubAllGlobals()
  resetBreaker()
})

const src = (over: Partial<OntologySource> = {}): OntologySource => ({
  id: 'ejkim',
  name: '이메일 온톨로지',
  url: 'http://fuseki.test:30303',
  dataset: 'ontology',
  relationNamespace: 'urn:ejkim:ontology:',
  labelPredicate: RDFS_LABEL,
  ...over,
})

const bindingsFor = (predicate: string) => ({
  results: {
    bindings: [
      {
        s: { type: 'uri', value: 'urn:node:acme' },
        sl: { type: 'literal', value: 'Acme' },
        p: { type: 'uri', value: predicate },
        o: { type: 'uri', value: 'urn:node:beta' },
        ol: { type: 'literal', value: 'Beta' },
      },
    ],
  },
})

const ok = (body: unknown) =>
  vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify(body), { status: 200 }),
  )

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

describe('rankByTermMatches', () => {
  const n = (uri: string): EntityNode => ({ uri, label: uri, source: 's' })

  it('여러 용어에 걸린 개체가 앞에 온다', () => {
    const 정아라 = [n('a'), n('b'), n('일정-0615')]
    const 날짜 = [n('일정-0615'), n('일정-0618')]
    expect(rankByTermMatches([정아라, 날짜]).map((x) => x.uri)).toEqual([
      '일정-0615', 'a', 'b', '일정-0618',
    ])
  })

  it('중복은 한 번만, 매치 수 같으면 원래 순서', () => {
    expect(rankByTermMatches([[n('x')], [n('y')]]).map((v) => v.uri)).toEqual(['x', 'y'])
  })
})

describe('searchEntities', () => {
  it('바인딩을 노드와 엣지로 바꾸고 출처를 단다', async () => {
    vi.stubGlobal('fetch', ok(bindingsFor('urn:ejkim:ontology:거래')))

    const r = await searchEntities(['Acme'], src())

    expect(r.nodes).toEqual([
      { uri: 'urn:node:acme', label: 'Acme', source: 'ejkim' },
      { uri: 'urn:node:beta', label: 'Beta', source: 'ejkim' },
    ])
    expect(r.edges).toEqual([
      { source: 'urn:node:acme', target: 'urn:node:beta', relation: '거래', from: 'ejkim' },
    ])
  })

  // 예전엔 관계 접두사가 'urn:weknora:rel:'로 박혀 있어서, 승훈·ejkim으로 물으면
  // FILTER에 아무것도 안 걸렸다. 이제 소스 설정에서 온다.
  it('관계 네임스페이스를 소스에서 가져온다', async () => {
    const spy = ok(bindingsFor('http://seunghoon-ontology/schema#참석'))
    vi.stubGlobal('fetch', spy)

    const source = src({
      id: 'seunghoon',
      relationNamespace: 'http://seunghoon-ontology/schema#',
    })
    const r = await searchEntities(['Acme'], source)

    expect(String(spy.mock.calls[0][1].body)).toContain('http://seunghoon-ontology/schema#')
    expect(r.edges[0].relation).toBe('참석')
  })

  it('소스의 url과 dataset으로 엔드포인트를 만든다', async () => {
    const spy = ok(bindingsFor('urn:ejkim:ontology:거래'))
    vi.stubGlobal('fetch', spy)

    await searchEntities(['Acme'], src())

    expect(spy.mock.calls[0][0]).toBe('http://fuseki.test:30303/ontology/sparql')
  })

  it('기본 그래프와 named 그래프를 모두 훑는다', async () => {
    const spy = ok(bindingsFor('urn:ejkim:ontology:거래'))
    vi.stubGlobal('fetch', spy)

    await searchEntities(['Acme'], src())

    expect(String(spy.mock.calls[0][1].body)).toContain('UNION')
  })

  it('라벨이 없으면 요청을 보내지 않는다', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)

    expect(await searchEntities([], src())).toEqual({ nodes: [], edges: [] })
    expect(spy).not.toHaveBeenCalled()
  })

  it('검색어를 이스케이프해서 질의에 넣는다', async () => {
    const spy = ok(bindingsFor('urn:ejkim:ontology:거래'))
    vi.stubGlobal('fetch', spy)

    await searchEntities(['a"b'], src())

    expect(String(spy.mock.calls[0][1].body)).toContain('a\\"b')
  })

  it('Fuseki가 죽으면 던진다 (호출자가 degrade 판단)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))

    await expect(searchEntities(['Acme'], src())).rejects.toThrow(/500/)
  })
})

describe('searchGraphs', () => {
  const three = [
    src({ id: 'ejkim', relationNamespace: 'urn:ejkim:ontology:' }),
    src({ id: 'kakao', url: 'http://fuseki.test:30301', relationNamespace: 'urn:feda:kg:vocab/' }),
    src({
      id: 'seunghoon',
      url: 'http://fuseki.test:30310',
      relationNamespace: 'http://seunghoon-ontology/schema#',
    }),
  ]

  it('세 소스를 모두 물어 결과를 합치고 출처를 남긴다', async () => {
    const byPort: Record<string, string> = {
      '30303': 'urn:ejkim:ontology:거래',
      '30301': 'urn:feda:kg:vocab/관련',
      '30310': 'http://seunghoon-ontology/schema#참석',
    }
    const spy = vi.fn(async (url: string) => {
      const port = url.match(/:(\d+)\//)![1]
      return new Response(JSON.stringify(bindingsFor(byPort[port])), { status: 200 })
    })
    vi.stubGlobal('fetch', spy)

    const r = await searchGraphs(['Acme'], three)

    expect(spy).toHaveBeenCalledTimes(3)
    expect(r.sources.map((s) => s.id)).toEqual(['ejkim', 'kakao', 'seunghoon'])
    expect(r.sources.every((s) => s.ok)).toBe(true)
    expect(r.edges.map((e) => e.relation)).toEqual(['거래', '관련', '참석'])
    expect(r.edges.map((e) => e.from)).toEqual(['ejkim', 'kakao', 'seunghoon'])
  })

  it('한 소스가 죽어도 나머지 답을 돌려주고 실패를 알려준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes(':30301')) throw new Error('ECONNREFUSED')
        return new Response(JSON.stringify(bindingsFor('urn:ejkim:ontology:거래')), { status: 200 })
      }),
    )

    const r = await searchGraphs(['Acme'], three)

    const failed = r.sources.filter((s) => !s.ok)
    expect(failed).toHaveLength(1)
    expect(failed[0].id).toBe('kakao')
    expect(failed[0].error).toContain('ECONNREFUSED')
    // 나머지 둘의 노드는 그대로 온다 — "못 찾음"과 "못 물어봄"은 다르다.
    expect(r.nodes.length).toBeGreaterThan(0)
  })

  // 폴백을 소스 단위로 판단했더니 "글리세롤·제품·문서"를 물었을 때 흔한 말인 "제품"이
  // 라벨에 걸려서 글리세롤의 리터럴 검색이 통째로 막혔다. 용어마다 따로 판단해야 한다.
  it('흔한 말이 라벨에 걸려도 다른 용어의 리터럴 검색을 막지 않는다', async () => {
    const scan = {
      results: {
        bindings: [
          {
            s: { type: 'uri', value: 'urn:doc:1' },
            p: { type: 'uri', value: 'urn:ejkim:ontology:extractedText' },
            snip: { type: 'literal', value: '…글리세롤…' },
          },
        ],
      },
    }
    const labels = {
      results: {
        bindings: [{ s: { type: 'uri', value: 'urn:doc:1' }, l: { type: 'literal', value: 'MSDS.pdf' } }],
      },
    }

    const spy = vi.fn(async (_url: string, init: RequestInit) => {
      const body = String(init.body)
      // "제품"은 라벨로 잡히고 "글리세롤"은 안 잡힌다.
      if (body.includes('CONTAINS(?sl')) {
        return new Response(
          JSON.stringify(body.includes('제품') ? bindingsFor('urn:ejkim:ontology:거래') : { results: { bindings: [] } }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify(body.includes('VALUES') ? labels : scan), { status: 200 })
    })
    vi.stubGlobal('fetch', spy)

    const r = await searchGraphs(['글리세롤', '제품'], [src()])

    // 제품은 라벨로 찾고, 글리세롤은 본문까지 뒤져서 둘 다 결과가 있어야 한다.
    expect(r.nodes.length).toBeGreaterThan(0)
    expect(r.textHits).toHaveLength(1)
    expect(r.textHits[0].label).toBe('MSDS.pdf')
    expect(r.sources[0].searchedText).toBe(true)
  })

  it('용어마다 물어도 같은 개체는 한 번만 담는다', async () => {
    vi.stubGlobal('fetch', ok(bindingsFor('urn:ejkim:ontology:거래')))

    const r = await searchGraphs(['가', '나', '다'], [src()])

    expect(r.nodes.map((n) => n.uri)).toEqual(['urn:node:acme', 'urn:node:beta'])
    expect(r.edges).toHaveLength(1)
  })

  // 죽은 소스는 TCP가 끊길 때까지 기다리느라 호출마다 10초 넘게 먹는다(실측 kakao 10.5초).
  // 한 번 실패하면 잠깐 건너뛴다.
  it('한 번 실패한 소스는 다음 호출에서 건너뛴다', async () => {
    resetBreaker()
    const spy = vi.fn(async (url: string) => {
      if (url.includes(':30301')) throw new Error('ECONNREFUSED')
      return new Response(JSON.stringify(bindingsFor('urn:ejkim:ontology:거래')), { status: 200 })
    })
    vi.stubGlobal('fetch', spy)

    await searchGraphs(['Acme'], three)
    const afterFirst = spy.mock.calls.length

    const r = await searchGraphs(['Acme'], three)

    // 두 번째 호출에서 kakao는 아예 안 친다 — 살아 있는 둘만 간다.
    expect(spy.mock.calls.length).toBe(afterFirst + 2)
    const kakao = r.sources.find((s) => s.id === 'kakao')!
    expect(kakao.ok).toBe(false)
    expect(kakao.error).toContain('건너뜀')
    // 나머지는 그대로 답한다.
    expect(r.sources.filter((s) => s.ok).map((s) => s.id)).toEqual(['ejkim', 'seunghoon'])
  })

  it('건너뛴 것으로는 차단 시간이 갱신되지 않는다 (영영 안 풀리면 안 된다)', async () => {
    resetBreaker()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down')
      }),
    )

    await searchGraphs(['Acme'], three)
    const second = await searchGraphs(['Acme'], three)

    // 두 번째는 전부 건너뛴 상태여야 하고, 그 사실이 실패 시각을 다시 찍지 않아야 한다.
    expect(second.sources.every((s) => s.error?.includes('건너뜀'))).toBe(true)
    resetBreaker()
    const third = await searchGraphs(['Acme'], three)
    expect(third.sources.every((s) => s.error === 'down')).toBe(true)
  })

  it('성공하면 차단이 풀린다', async () => {
    resetBreaker()
    let fail = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (fail) throw new Error('down')
        return new Response(JSON.stringify(bindingsFor('urn:ejkim:ontology:거래')), { status: 200 })
      }),
    )

    await searchGraphs(['Acme'], three)
    fail = false
    resetBreaker() // 쿨다운을 기다리는 대신 수동 재시도를 흉내낸다
    const r = await searchGraphs(['Acme'], three)
    expect(r.sources.every((s) => s.ok)).toBe(true)

    // 이제 차단이 풀렸으니 다음 호출도 정상으로 간다.
    const again = await searchGraphs(['Acme'], three)
    expect(again.sources.every((s) => s.ok)).toBe(true)
  })

  it('전부 죽어도 던지지 않는다', async () => {
    resetBreaker()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down')
      }),
    )

    const r = await searchGraphs(['Acme'], three)

    expect(r.nodes).toEqual([])
    expect(r.sources.every((s) => !s.ok)).toBe(true)
  })
})

describe('searchText', () => {
  const scanRows = {
    results: {
      bindings: [
        {
          s: { type: 'uri', value: 'urn:attachment:1' },
          p: { type: 'uri', value: 'urn:ejkim:ontology:extractedText' },
          snip: { type: 'literal', value: '…글리세롤 5% 함유…' },
        },
      ],
    },
  }
  const labelRows = {
    results: {
      bindings: [
        {
          s: { type: 'uri', value: 'urn:attachment:1' },
          l: { type: 'literal', value: '안전기준적합확인신청서_방향제.pdf' },
        },
      ],
    },
  }

  /** 스캔 질의 → 라벨 질의 순으로 답한다. */
  const twoPhase = () => {
    let n = 0
    return vi.fn(async (_url: string, _init: RequestInit) => {
      n += 1
      return new Response(JSON.stringify(n === 1 ? scanRows : labelRows), { status: 200 })
    })
  }

  it('리터럴 안의 검색어를 찾고 라벨을 따로 붙인다', async () => {
    const spy = twoPhase()
    vi.stubGlobal('fetch', spy)

    const hits = await searchText('글리세롤', src())

    expect(spy).toHaveBeenCalledTimes(2)
    expect(hits).toEqual([
      {
        uri: 'urn:attachment:1',
        label: '안전기준적합확인신청서_방향제.pdf',
        snippet: '…글리세롤 5% 함유…',
        predicate: 'extractedText',
        source: 'ejkim',
      },
    ])
  })

  // 스캔 질의에 OPTIONAL로 라벨을 넣었더니 ejkim이 15초를 넘겨 통째로 실패했다.
  // 스캔은 가볍게 두고 라벨은 VALUES로 따로 받는다.
  it('스캔 질의에는 라벨 조인을 넣지 않는다', async () => {
    const spy = twoPhase()
    vi.stubGlobal('fetch', spy)

    await searchText('글리세롤', src())

    expect(String(spy.mock.calls[0][1].body)).not.toContain('OPTIONAL')
    expect(String(spy.mock.calls[1][1].body)).toContain('VALUES')
  })

  it('찾은 게 없으면 라벨 질의를 보내지 않는다', async () => {
    const spy = ok({ results: { bindings: [] } })
    vi.stubGlobal('fetch', spy)

    expect(await searchText('없는말', src())).toEqual([])
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('검색어를 이스케이프한다', async () => {
    const spy = twoPhase()
    vi.stubGlobal('fetch', spy)

    await searchText('a"b', src())

    expect(String(spy.mock.calls[0][1].body)).toContain('a\\"b')
  })
})

describe('fusekiHealth', () => {
  it('연결 실패를 던지지 않고 ok:false로 돌려준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )

    const h = await fusekiHealth(src())
    expect(h.ok).toBe(false)
    expect(h.hasData).toBe(false)
    expect(h.error).toContain('ECONNREFUSED')
  })

  // ASK를 쓰면 {"head":{},"boolean":true}가 와서 results.bindings가 없다.
  // 예전 구현은 그걸 읽다 TypeError를 내고 catch가 삼켜서 늘 false였다.
  it('ASK가 아니라 SELECT를 써서 응답 모양이 어긋나지 않는다', async () => {
    const spy = ok({ results: { bindings: [{ s: { type: 'uri', value: 'urn:x' } }] } })
    vi.stubGlobal('fetch', spy)

    const h = await fusekiHealth(src())

    expect(String(spy.mock.calls[0][1].body)).toContain('SELECT')
    expect(h).toEqual({ ok: true, hasData: true })
  })

  // ejkim은 데이터가 전부 named graph에 있어서 기본 그래프만 보면 비어 보인다.
  it('named graph까지 훑는다', async () => {
    const spy = ok({ results: { bindings: [] } })
    vi.stubGlobal('fetch', spy)

    const h = await fusekiHealth(src())

    expect(String(spy.mock.calls[0][1].body)).toContain('GRAPH')
    // 닿았지만 비어 있다 — 못 닿은 것과 다르다.
    expect(h).toEqual({ ok: true, hasData: false })
  })
})
