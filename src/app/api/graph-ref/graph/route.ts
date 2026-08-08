import { requireSession } from '@/lib/auth/guard'
import { findRefByName, loadEgo, refForSlug } from '@/lib/graph-ref/store'

/**
 * 개체 중심 1홉 그래프. 문서 화면의 [그래프] 토글이 부른다.
 *
 * Postgres 사본이 아니라 그래프 DB를 직접 본다 — 방금 승격한 문서는 [[링크]]가
 * 아직 없어서 Page.outLinks로 그리면 노드 하나만 뜬다. 관계 순회는 원본이 답이다.
 */
export async function GET(req: Request) {
  const authed = await requireSession()
  if (!authed) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const slug = url.searchParams.get('slug')?.trim()
  const name = url.searchParams.get('name')?.trim()
  // 관계·종류 필터 — 화면의 칩. 값은 buildEgo가 이웃의 rel·types와 대조만 한다.
  const rel = url.searchParams.get('rel')?.trim() || undefined
  const type = url.searchParams.get('type')?.trim() || undefined
  if (!slug && !name) return Response.json({ error: 'slug 또는 name이 필요합니다' }, { status: 400 })

  // slug 조회는 GraphRef가 없어도 적재본 개체 문서면 즉석 참조로 그린다.
  const ref = slug ? await refForSlug(slug) : await findRefByName(name!)
  if (!ref) return Response.json({ error: '개체 참조가 없습니다' }, { status: 404 })

  try {
    const { ego, ambiguousCount } = await loadEgo(ref, { rel, type })
    // 그린 노드(nodes[0]은 중심)만 추려 응답을 가볍게 유지한다.
    const drawn = new Set(ego.nodes.slice(1).map((n) => n.slug))
    return Response.json({
      center: ref.pageSlug,
      name: ref.name,
      type: ref.type,
      sourceId: ref.sourceId,
      ambiguousCount,
      nodes: ego.nodes,
      edges: ego.edges,
      neighborCount: ego.neighborCount,
      rels: ego.rels,
      types: ego.types,
      // 중심 개체의 속성 — 이미 계산해 둔 것이라 추가 질의가 없다.
      // 인스펙터가 아무 노드도 선택되지 않았을 때 이걸 보여준다.
      attrs: ego.attrs.slice(0, 12),
      // 그린 노드의 관계·방향·종류. 노드를 고르면 문서를 기다리지 않고 바로 뜬다.
      neighbors: ego.neighbors
        .filter((n) => drawn.has(n.uri))
        .map((n) => ({ uri: n.uri, rel: n.rel, dir: n.dir, types: n.types })),
    })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 })
  }
}
