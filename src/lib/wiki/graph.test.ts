import { describe, expect, it } from 'vitest'
import { buildGraph, layoutGraph, topConnected } from './graph'

const page = (slug: string, outLinks: string[] = []) => ({
  slug,
  title: slug,
  pageType: 'concept',
  outLinks,
})

describe('buildGraph', () => {
  it('실존 문서 사이 링크만 에지로 만든다 — 죽은 링크·자기 링크 제외', () => {
    const { nodes, edges } = buildGraph([
      page('a', ['b', 'ghost', 'a']),
      page('b'),
    ])
    expect(edges).toEqual([{ source: 'a', target: 'b' }])
    expect(nodes.map((n) => n.slug)).toEqual(['a', 'b'])
  })

  it('양방향 링크는 에지 하나로 합치고 degree는 무방향으로 센다', () => {
    const { nodes, edges } = buildGraph([
      page('a', ['b']),
      page('b', ['a', 'c']),
      page('c'),
    ])
    expect(edges).toHaveLength(2)
    const deg = Object.fromEntries(nodes.map((n) => [n.slug, n.degree]))
    expect(deg).toEqual({ a: 1, b: 2, c: 1 })
  })

  it('링크 없는 고립 노드도 노드 목록에 남는다', () => {
    const { nodes, edges } = buildGraph([page('solo')])
    expect(nodes).toHaveLength(1)
    expect(edges).toHaveLength(0)
  })
})

describe('topConnected', () => {
  it('degree 상위 n개와 그들 사이 에지만 남긴다', () => {
    const g = buildGraph([
      page('hub', ['a', 'b', 'c']),
      page('a', ['b']),
      page('b'),
      page('c'),
    ])
    const sub = topConnected(g, 3)
    expect(sub.nodes.map((n) => n.slug).sort()).toEqual(['a', 'b', 'hub'])
    // c로 가는 에지는 잘리고 hub-a, hub-b, a-b만 남는다
    expect(sub.edges).toHaveLength(3)
  })

  it('n이 전체보다 크면 그대로 돌려준다', () => {
    const g = buildGraph([page('a', ['b']), page('b')])
    expect(topConnected(g, 10)).toBe(g)
  })
})

describe('layoutGraph', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e'].map((s) => ({ slug: s }))
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'a', target: 'c' },
    { source: 'a', target: 'd' },
  ]

  it('같은 시드면 같은 좌표 (결정적)', () => {
    expect(layoutGraph(nodes, edges)).toEqual(layoutGraph(nodes, edges))
  })

  it('모든 좌표가 유한하고 노드끼리 겹치지 않는다', () => {
    const pos = Object.values(layoutGraph(nodes, edges))
    expect(pos).toHaveLength(5)
    for (const p of pos) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
    for (let i = 0; i < pos.length; i++)
      for (let j = i + 1; j < pos.length; j++) {
        const d = Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y)
        expect(d).toBeGreaterThan(10)
      }
  })

  it('빈 그래프는 빈 결과', () => {
    expect(layoutGraph([], [])).toEqual({})
  })
})
