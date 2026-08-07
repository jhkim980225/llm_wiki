import { describe, it, expect } from 'vitest'
import { buildEgo, MAX_GRAPH_NEIGHBORS, type Binding } from './graph'
import { RDFS_LABEL, type OntologySource } from '@/lib/ontology/source'

const source: OntologySource = {
  id: 'test',
  name: '테스트',
  url: 'http://localhost',
  dataset: 'ontology',
  relationNamespace: 'urn:t:rel:',
  labelPredicate: RDFS_LABEL,
}

const center = { uri: 'urn:t:e:kim', label: '김' }

/** 바인딩 한 줄 만들기. other는 `lit:`로 시작하면 리터럴로 본다. */
const row = (rel: string, other: string, dir: 'in' | 'out', otherLabel?: string): Binding => {
  const b: Binding = {
    rel: { type: 'uri', value: rel },
    other: other.startsWith('lit:')
      ? { type: 'literal', value: other.slice(4) }
      : { type: 'uri', value: other },
    dir: { type: 'literal', value: dir },
  }
  if (otherLabel) b.otherLabel = { type: 'literal', value: otherLabel }
  return b
}

describe('buildEgo', () => {
  it('out/in 관계를 이웃·노드·에지로 만든다', () => {
    const r = buildEgo(source, center, [
      row('urn:t:rel:worksAt', 'urn:t:e:feda', 'out', '페다'),
      row('urn:t:rel:manages', 'urn:t:e:lee', 'in', '이'),
    ])

    expect(r.neighbors).toEqual([
      { uri: 'urn:t:e:lee', label: '이', rel: 'manages', dir: 'in' },
      { uri: 'urn:t:e:feda', label: '페다', rel: 'worksAt', dir: 'out' },
    ])
    // 중심이 항상 nodes[0], degree는 붙은 에지 수
    expect(r.nodes[0]).toEqual({
      slug: 'urn:t:e:kim',
      title: '김',
      pageType: 'entity',
      degree: 2,
    })
    expect(r.nodes.map((n) => n.slug)).toEqual(['urn:t:e:kim', 'urn:t:e:feda', 'urn:t:e:lee'])
    expect(r.nodes.every((n) => n.pageType === 'entity')).toBe(true)
    expect(r.nodes.slice(1).every((n) => n.degree === 1)).toBe(true)
    // in 관계는 상대가 source
    expect(r.edges).toEqual([
      { source: 'urn:t:e:lee', target: 'urn:t:e:kim' },
      { source: 'urn:t:e:kim', target: 'urn:t:e:feda' },
    ])
  })

  it('리터럴은 속성으로 가고 이웃이 되지 않는다', () => {
    const r = buildEgo(source, center, [
      row('urn:t:rel:email', 'lit:kim@feda.io', 'out'),
      row('urn:t:rel:worksAt', 'urn:t:e:feda', 'out', '페다'),
    ])

    expect(r.attrs).toEqual([{ key: 'email', value: 'kim@feda.io' }])
    expect(r.neighbors.map((n) => n.uri)).toEqual(['urn:t:e:feda'])
    expect(r.edges).toHaveLength(1)
  })

  it('labelPredicate는 속성에 넣지 않는다', () => {
    const r = buildEgo(source, center, [row(RDFS_LABEL, 'lit:김', 'out')])
    expect(r.attrs).toEqual([])
    expect(r.nodes).toHaveLength(1)
  })

  // 개체 하나에 이웃이 수백 개 달린다(실측 198). 그림만 자르고 본문용 neighbors는 남긴다.
  it('그림은 상한까지만 그리고 이웃 총수는 따로 알린다', () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      row('urn:t:rel:knows', `urn:t:e:p${String(i).padStart(2, '0')}`, 'out', `사람${i}`),
    )
    const r = buildEgo(source, center, rows)

    expect(r.neighbors).toHaveLength(40)
    expect(r.neighborCount).toBe(40)
    expect(r.nodes).toHaveLength(MAX_GRAPH_NEIGHBORS + 1) // 중심 포함
    expect(r.edges).toHaveLength(MAX_GRAPH_NEIGHBORS)
  })

  // 앞에서부터 자르면 정렬 때문에 한 관계가 자리를 다 먹는다.
  it('상한을 넘으면 관계 종류별로 돌아가며 뽑는다', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      row('urn:t:rel:usesAccount', `urn:t:e:a${String(i).padStart(2, '0')}`, 'out', `계정${i}`),
    )
    const r = buildEgo(source, center, [
      ...many,
      row('urn:t:rel:worksAt', 'urn:t:e:feda', 'out', '페다'),
      row('urn:t:rel:manages', 'urn:t:e:lee', 'in', '이'),
    ])

    const rels = new Set(
      r.nodes.slice(1).map((n) => r.neighbors.find((x) => x.uri === n.slug)!.rel),
    )
    expect(rels).toEqual(new Set(['usesAccount', 'worksAt', 'manages']))
  })

  it('이웃이 상한보다 적으면 전부 그린다', () => {
    const r = buildEgo(source, center, [
      row('urn:t:rel:worksAt', 'urn:t:e:feda', 'out', '페다'),
      row('urn:t:rel:manages', 'urn:t:e:lee', 'in', '이'),
    ])
    expect(r.nodes).toHaveLength(3)
    expect(r.neighborCount).toBe(2)
  })

  // 문서 맨 위 타입 줄이 같은 말을 하고, 값이 원시 URI라 표에 두면 읽히지 않는다.
  it('rdf:type도 속성에 넣지 않는다', () => {
    const r = buildEgo(source, center, [
      row('http://www.w3.org/1999/02/22-rdf-syntax-ns#type', 'urn:t:c:Person', 'out'),
      row('urn:t:rel:worksAt', 'urn:t:e:feda', 'out', '페다'),
    ])
    expect(r.attrs).toEqual([])
    expect(r.neighbors.map((n) => n.uri)).toEqual(['urn:t:e:feda'])
  })

  it('관계 네임스페이스 밖 술어는 URI 상대라도 속성으로 본다', () => {
    const r = buildEgo(source, center, [
      row('http://xmlns.com/foaf/0.1/homepage', 'urn:t:e:site', 'out', '홈'),
    ])
    expect(r.attrs).toEqual([{ key: 'homepage', value: 'urn:t:e:site' }])
    expect(r.neighbors).toEqual([])
    expect(r.edges).toEqual([])
  })

  it('자기 자신을 가리키는 관계는 버린다', () => {
    const r = buildEgo(source, center, [
      row('urn:t:rel:sameAs', center.uri, 'out', '김'),
      row('urn:t:rel:sameAs', center.uri, 'in', '김'),
    ])
    expect(r.neighbors).toEqual([])
    expect(r.nodes).toEqual([
      { slug: 'urn:t:e:kim', title: '김', pageType: 'entity', degree: 0 },
    ])
    expect(r.edges).toEqual([])
  })

  it('같은 쌍은 방향·술어가 달라도 에지 하나 (무방향 중복 제거)', () => {
    const r = buildEgo(source, center, [
      row('urn:t:rel:knows', 'urn:t:e:lee', 'out', '이'),
      row('urn:t:rel:knows', 'urn:t:e:lee', 'in', '이'),
      row('urn:t:rel:manages', 'urn:t:e:lee', 'out', '이'),
    ])
    expect(r.neighbors).toHaveLength(3)
    // 정렬된 이웃 중 첫 행(knows/in)이 방향을 정한다 — 행 순서와 무관하게 늘 같다
    expect(r.edges).toEqual([{ source: 'urn:t:e:lee', target: 'urn:t:e:kim' }])
    expect(r.nodes.map((n) => n.degree)).toEqual([1, 1])
  })

  it('같은 속성이 여러 번 오면 전부 살리되 중복 행은 제거한다', () => {
    const r = buildEgo(source, center, [
      row('urn:t:rel:tag', 'lit:영업', 'out'),
      row('urn:t:rel:tag', 'lit:견적', 'out'),
      row('urn:t:rel:tag', 'lit:영업', 'out'),
    ])
    expect(r.attrs).toEqual([
      { key: 'tag', value: '견적' },
      { key: 'tag', value: '영업' },
    ])
  })

  it('in 방향 리터럴은 무시한다', () => {
    const r = buildEgo(source, center, [row('urn:t:rel:note', 'lit:버려짐', 'in')])
    expect(r.attrs).toEqual([])
  })

  it('빈 rows면 중심 노드 하나만', () => {
    const r = buildEgo(source, center, [])
    expect(r).toEqual({
      attrs: [],
      neighbors: [],
      nodes: [{ slug: 'urn:t:e:kim', title: '김', pageType: 'entity', degree: 0 }],
      edges: [],
      neighborCount: 0,
    })
  })

  it('라벨 없는 이웃은 localName을 표시명으로 쓴다', () => {
    const r = buildEgo(source, center, [
      row('urn:t:rel:worksAt', 'http://ex.org/schema#페다', 'out'),
      row('urn:t:rel:knows', 'urn:t:e:lee', 'out'),
    ])
    expect(r.neighbors.map((n) => n.label)).toEqual(['lee', '페다'])
  })

  it('입력 순서를 섞어도 결과가 같다', () => {
    const rows = [
      row('urn:t:rel:worksAt', 'urn:t:e:feda', 'out', '페다'),
      row('urn:t:rel:knows', 'urn:t:e:lee', 'in', '이'),
      row('urn:t:rel:knows', 'urn:t:e:ahn', 'out'),
      row('urn:t:rel:email', 'lit:kim@feda.io', 'out'),
      row('urn:t:rel:tag', 'lit:영업', 'out'),
      row('urn:t:rel:sameAs', center.uri, 'out'),
      row('http://ex.org/p#외부', 'lit:값', 'out'),
    ]
    const base = buildEgo(source, center, rows)
    // 회전으로 만든 모든 순열 변형에서 같은 출력이어야 한다
    for (let i = 1; i < rows.length; i++) {
      const rotated = [...rows.slice(i), ...rows.slice(0, i)].reverse()
      expect(buildEgo(source, center, rotated)).toEqual(base)
    }
  })
})
