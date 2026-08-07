import { requireSession } from '@/lib/auth/guard'
import { db } from '@/lib/db'
import { parseWbsMarkdown } from '@/lib/wbs/markdown'

/** 현재 사용자·워크스페이스의 WBS 플랜 목록(최신순). */
export async function GET() {
  const authed = await requireSession()
  if (!authed) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (!authed.claims.ws) return Response.json({ plans: [] })

  const plans = await db.wbsPlan.findMany({
    where: { userId: authed.user.id, workspaceId: authed.claims.ws },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, updatedAt: true, _count: { select: { tasks: true } } },
    take: 100,
  })
  return Response.json({ plans })
}

/** 플랜 생성. body: { title?, markdown? } — markdown이 있으면 표를 파싱해 태스크로 만든다. */
export async function POST(req: Request) {
  const authed = await requireSession()
  if (!authed) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (!authed.claims.ws) return Response.json({ error: '워크스페이스가 필요합니다' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : '새 WBS'
  const parsed = typeof body?.markdown === 'string' ? parseWbsMarkdown(body.markdown) : []

  const plan = await db.wbsPlan.create({
    data: {
      userId: authed.user.id,
      workspaceId: authed.claims.ws,
      title,
      tasks: { create: parsed.map((t, i) => ({ ...t, sortOrder: i })) },
    },
    select: { id: true },
  })
  return Response.json({ id: plan.id, tasks: parsed.length }, { status: 201 })
}
