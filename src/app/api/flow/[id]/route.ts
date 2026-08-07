import { z } from 'zod'
import { requireSession } from '@/lib/auth/guard'
import { db } from '@/lib/db'
import { nextRunAt } from '@/lib/flow/schedule'

const Patch = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  prompt: z.string().trim().min(1).max(4000).optional(),
  templateSlug: z.string().trim().min(1).optional(),
  targetFolderName: z.string().trim().max(120).nullable().optional(),
  scheduleWeekday: z.number().int().min(0).max(6).optional(),
  scheduleHour: z.number().int().min(0).max(23).optional(),
  enabled: z.boolean().optional(),
})

/** 소유 워크스페이스의 FLOW만 만진다. */
async function owned(id: string, ws: string) {
  return db.flowTask.findFirst({ where: { id, workspaceId: ws, deletedAt: null } })
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const authed = await requireSession()
  if (!authed?.claims.ws) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const flow = await db.flowTask.findFirst({
    where: { id, workspaceId: authed.claims.ws, deletedAt: null },
    include: { runs: { orderBy: { startedAt: 'desc' }, take: 30 } },
  })
  if (!flow) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json(flow)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authed = await requireSession()
  if (!authed?.claims.ws) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  if (!(await owned(id, authed.claims.ws))) return Response.json({ error: 'not found' }, { status: 404 })

  const parsed = Patch.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'invalid body' }, { status: 400 })
  }
  const d = parsed.data

  const updated = await db.flowTask.update({
    where: { id },
    data: d,
  })
  // 주기·활성 상태가 바뀌면 다음 실행 시각을 다시 계산한다.
  const next = updated.enabled
    ? nextRunAt(updated.scheduleWeekday, updated.scheduleHour, new Date())
    : null
  const final = await db.flowTask.update({ where: { id }, data: { nextRunAt: next } })
  return Response.json(final)
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const authed = await requireSession()
  if (!authed?.claims.ws) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  if (!(await owned(id, authed.claims.ws))) return Response.json({ error: 'not found' }, { status: 404 })

  await db.flowTask.update({ where: { id }, data: { deletedAt: new Date(), enabled: false, nextRunAt: null } })
  return Response.json({ id, deleted: true })
}
