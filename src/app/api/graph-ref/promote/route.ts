import { z } from 'zod'
import { requireSession } from '@/lib/auth/guard'
import { findRefByName, findRefBySlug, promoteRef } from '@/lib/graph-ref/store'

const Body = z.object({
  slug: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
})

/**
 * 개체 참조를 위키 문서로 승격한다. 그래프에서 1홉 이웃을 끌어와 본문을 만든다.
 *
 * 자동 생성이 아니라 사람이 누르는 동작이다 — 죽은 링크를 밟는 것만으로 문서가
 * 불어나면 트리·검색이 오염된다.
 */
export async function POST(req: Request) {
  const authed = await requireSession()
  if (!authed) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success || (!parsed.data.slug && !parsed.data.name)) {
    return Response.json({ error: 'slug 또는 name이 필요합니다' }, { status: 400 })
  }

  const ref = parsed.data.slug
    ? await findRefBySlug(parsed.data.slug)
    : await findRefByName(parsed.data.name!)
  if (!ref) return Response.json({ error: '개체 참조가 없습니다' }, { status: 404 })

  try {
    const result = await promoteRef(ref)
    return Response.json(result)
  } catch (e) {
    // 그래프 접근 실패·이름 미발견은 사용자가 고칠 수 있는 상황이라 502가 아니라 400으로 준다.
    return Response.json({ error: (e as Error).message }, { status: 400 })
  }
}
