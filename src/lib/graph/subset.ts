export type GraphPage = {
  slug: string
  title: string
  pageType: string
  inLinks: string[]
  outLinks: string[]
}

export type GraphNode = { slug: string; title: string; pageType: string; linkCount: number }
export type GraphEdge = { source: string; target: string }
export type GraphMeta = {
  mode: string
  total: number
  returned: number
  truncated: boolean
  center?: string
  depth?: number
}
export type GraphRequest = {
  mode?: 'overview' | 'ego'
  center?: string
  depth?: number
  types?: string[]
  limit?: number
}

/**
 * center에서 depth 단계까지 양방향 BFS.
 * 타입 필터는 탐색 경로도 막는다 — 걸린 이웃은 방문하지 않고 그 너머로 퍼지지도 않는다.
 * 센터 자신이 필터에 걸리면 빈 집합을 돌려준다 (호출자가 returned=0으로 표시).
 */
function bfsEgo(
  bySlug: Map<string, GraphPage>,
  center: string,
  depth: number,
  typeAllow: Set<string>,
  limit: number,
): Set<string> {
  const centerPage = bySlug.get(center)
  if (!centerPage) return new Set()
  if (typeAllow.size > 0 && !typeAllow.has(centerPage.pageType)) return new Set()

  const visited = new Set<string>([center])
  let frontier = [center]

  for (let hop = 0; hop < depth; hop++) {
    if (limit > 0 && visited.size >= limit) break
    const next: string[] = []
    for (const slug of frontier) {
      const p = bySlug.get(slug)
      if (!p) continue
      for (const nb of [...p.outLinks, ...p.inLinks]) {
        if (visited.has(nb)) continue
        const np = bySlug.get(nb)
        if (!np) continue
        if (typeAllow.size > 0 && !typeAllow.has(np.pageType)) continue
        visited.add(nb)
        next.push(nb)
        if (limit > 0 && visited.size >= limit) break
      }
      if (limit > 0 && visited.size >= limit) break
    }
    frontier = next
    if (frontier.length === 0) break
  }
  return visited
}

/**
 * 전체 페이지에서 요청한 서브그래프를 잘라낸다. I/O 없음.
 * overview: 타입 필터 통과분을 linkCount 내림차순(동점은 slug)으로 정렬 후 limit 절단.
 * ego: center에서 depth 단계 BFS.
 */
export function computeGraphSubset(
  pages: GraphPage[],
  req: GraphRequest,
): { nodes: GraphNode[]; edges: GraphEdge[]; meta: GraphMeta } {
  const mode = req.mode ?? 'overview'
  const typeAllow = new Set((req.types ?? []).filter(Boolean))
  const limit = req.limit ?? 0

  const bySlug = new Map<string, GraphPage>()
  const linkCount = new Map<string, number>()
  for (const p of pages) {
    bySlug.set(p.slug, p)
    linkCount.set(p.slug, p.inLinks.length + p.outLinks.length)
  }

  let selected: Set<string>
  let total: number

  if (mode === 'ego') {
    if (!req.center) throw new Error('ego graph requires a center slug')
    if (!bySlug.has(req.center)) throw new Error(`ego center slug "${req.center}" not found`)
    selected = bfsEgo(bySlug, req.center, Math.max(1, req.depth ?? 1), typeAllow, limit)
    // ego의 분모는 전체 위키다 — 사용자는 필터된 모수가 아니라 위키 전체 대비로 본다.
    total = pages.length
  } else {
    const candidates = pages.filter((p) => typeAllow.size === 0 || typeAllow.has(p.pageType))
    total = candidates.length
    const sorted = [...candidates].sort((x, y) => {
      const lx = linkCount.get(x.slug)!
      const ly = linkCount.get(y.slug)!
      return ly - lx || (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0)
    })
    const capped = limit > 0 ? sorted.slice(0, limit) : sorted
    selected = new Set(capped.map((p) => p.slug))
  }

  const nodes: GraphNode[] = [...selected].map((slug) => {
    const p = bySlug.get(slug)!
    return { slug, title: p.title, pageType: p.pageType, linkCount: linkCount.get(slug)! }
  })
  nodes.sort((a, b) => b.linkCount - a.linkCount || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))

  const edges: GraphEdge[] = []
  for (const p of pages) {
    if (!selected.has(p.slug)) continue
    for (const target of p.outLinks) {
      if (selected.has(target)) edges.push({ source: p.slug, target })
    }
  }

  return {
    nodes,
    edges,
    meta: {
      mode,
      total,
      returned: nodes.length,
      truncated: nodes.length < total,
      ...(mode === 'ego' ? { center: req.center, depth: Math.max(1, req.depth ?? 1) } : {}),
    },
  }
}
