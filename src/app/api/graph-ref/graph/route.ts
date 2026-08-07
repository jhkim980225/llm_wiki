import { requireSession } from '@/lib/auth/guard'
import { findRefByName, findRefBySlug, loadEgo } from '@/lib/graph-ref/store'

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
  if (!slug && !name) return Response.json({ error: 'slug 또는 name이 필요합니다' }, { status: 400 })

  const ref = slug ? await findRefBySlug(slug) : await findRefByName(name!)
  if (!ref) return Response.json({ error: '개체 참조가 없습니다' }, { status: 404 })

  try {
    const { ego, ambiguousCount } = await loadEgo(ref)
    return Response.json({
      center: ref.pageSlug,
      name: ref.name,
      type: ref.type,
      sourceId: ref.sourceId,
      ambiguousCount,
      nodes: ego.nodes,
      edges: ego.edges,
      neighborCount: ego.neighborCount,
    })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 })
  }
}
