import { describe, it, expect } from 'vitest'
import { computeGraphSubset, type GraphPage } from './subset'

const page = (slug: string, out: string[], inl: string[], type = 'concept'): GraphPage => ({
  slug,
  title: slug.toUpperCase(),
  pageType: type,
  outLinks: out,
  inLinks: inl,
})

// a -> b -> c,  d 고립
const pages = [
  page('a', ['b'], []),
  page('b', ['c'], ['a']),
  page('c', [], ['b'], 'entity'),
  page('d', [], []),
]

describe('computeGraphSubset overview', () => {
  it('linkCount 내림차순, 동점은 slug 오름차순', () => {
    const r = computeGraphSubset(pages, {})
    expect(r.nodes.map((n) => n.slug)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('limit으로 자르고 truncated를 세운다', () => {
    const r = computeGraphSubset(pages, { limit: 2 })
    expect(r.nodes).toHaveLength(2)
    expect(r.meta.truncated).toBe(true)
    expect(r.meta.total).toBe(4)
    expect(r.meta.returned).toBe(2)
  })

  it('양 끝이 살아남은 엣지만 남는다', () => {
    const r = computeGraphSubset(pages, { limit: 2 })
    expect(r.edges).toEqual([{ source: 'a', target: 'b' }])
  })

  it('타입 필터가 total도 좁힌다', () => {
    const r = computeGraphSubset(pages, { types: ['entity'] })
    expect(r.nodes.map((n) => n.slug)).toEqual(['c'])
    expect(r.meta.total).toBe(1)
    expect(r.meta.truncated).toBe(false)
  })

  it('두 번 호출해도 순서가 같다', () => {
    const a = computeGraphSubset(pages, {})
    const b = computeGraphSubset(pages, {})
    expect(a.nodes).toEqual(b.nodes)
  })
})

describe('computeGraphSubset ego', () => {
  it('depth 1은 직접 이웃까지', () => {
    const r = computeGraphSubset(pages, { mode: 'ego', center: 'a', depth: 1 })
    expect(r.nodes.map((n) => n.slug).sort()).toEqual(['a', 'b'])
  })

  it('depth 2는 한 단계 더', () => {
    const r = computeGraphSubset(pages, { mode: 'ego', center: 'a', depth: 2 })
    expect(r.nodes.map((n) => n.slug).sort()).toEqual(['a', 'b', 'c'])
  })

  it('inLinks 방향으로도 퍼진다', () => {
    const r = computeGraphSubset(pages, { mode: 'ego', center: 'c', depth: 1 })
    expect(r.nodes.map((n) => n.slug).sort()).toEqual(['b', 'c'])
  })

  it('센터가 타입 필터에 걸리면 빈 결과다', () => {
    const r = computeGraphSubset(pages, { mode: 'ego', center: 'a', depth: 2, types: ['entity'] })
    expect(r.nodes).toEqual([])
    expect(r.meta.returned).toBe(0)
  })

  it('필터에 걸린 이웃을 통과해 퍼지지 않는다', () => {
    const r = computeGraphSubset(pages, { mode: 'ego', center: 'c', depth: 2, types: ['entity'] })
    expect(r.nodes.map((n) => n.slug)).toEqual(['c'])
  })

  it('limit이 방문 수를 제한한다', () => {
    const r = computeGraphSubset(pages, { mode: 'ego', center: 'a', depth: 3, limit: 2 })
    expect(r.nodes).toHaveLength(2)
  })

  it('ego의 total은 전체 페이지 수', () => {
    const r = computeGraphSubset(pages, { mode: 'ego', center: 'a', depth: 1 })
    expect(r.meta.total).toBe(4)
    expect(r.meta.center).toBe('a')
  })

  it('center가 없으면 던진다', () => {
    expect(() => computeGraphSubset(pages, { mode: 'ego' })).toThrow(/center/)
  })

  it('center가 존재하지 않으면 던진다', () => {
    expect(() => computeGraphSubset(pages, { mode: 'ego', center: 'zz' })).toThrow(/not found/)
  })
})
