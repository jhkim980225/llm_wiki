import { requireSession } from '@/lib/auth/guard'
import { db } from '@/lib/db'
import { parseWbsMarkdown } from '@/lib/wbs/markdown'

/** 소유권 확인 — 현재 사용자·워크스페이스의 플랜인지. */
async function ownedPlan(id: string) {
  const authed = await requireSession()
  if (!authed || !authed.claims.ws) return null
  const plan = await db.wbsPlan.findFirst({
    where: { id, userId: authed.user.id, workspaceId: authed.claims.ws },
    select: { id: true },
  })
  return plan ? { authed } : null
}

/** 플랜 + 태스크 + 각 태스크의 일정 셀. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!(await ownedPlan(id))) return Response.json({ error: 'not found' }, { status: 404 })

  const plan = await db.wbsPlan.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      weekStart: true,
      updatedAt: true,
      tasks: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          wbsCode: true,
          title: true,
          assignee: true,
          startDate: true,
          endDate: true,
          durationDays: true,
          entries: {
            orderBy: { date: 'asc' },
            select: { id: true, date: true, summary: true, detail: true, status: true, source: true },
          },
        },
      },
    },
  })
  return Response.json({ plan })
}

/** 플랜 수정. body: { title?, markdown? } — markdown이 오면 태스크를 통째로 교체(일정 셀도 함께 삭제). */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!(await ownedPlan(id))) return Response.json({ error: 'not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const data: { title?: string } = {}
  if (typeof body?.title === 'string' && body.title.trim()) data.title = body.title.trim()

  if (typeof body?.markdown === 'string') {
    const parsed = parseWbsMarkdown(body.markdown)
    // 태스크 교체 — 기존 태스크(및 cascade로 일정 셀) 삭제 후 재생성.
    await db.$transaction([
      db.wbsTask.deleteMany({ where: { planId: id } }),
      db.wbsPlan.update({
        where: { id },
        data: { ...data, tasks: { create: parsed.map((t, i) => ({ ...t, sortOrder: i })) } },
      }),
    ])
    return Response.json({ ok: true, tasks: parsed.length })
  }

  if (Object.keys(data).length > 0) {
    await db.wbsPlan.update({ where: { id }, data })
  }
  return Response.json({ ok: true })
}

/** 플랜 삭제(태스크·일정 셀 cascade). */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!(await ownedPlan(id))) return Response.json({ error: 'not found' }, { status: 404 })
  await db.wbsPlan.delete({ where: { id } })
  return Response.json({ ok: true })
}
