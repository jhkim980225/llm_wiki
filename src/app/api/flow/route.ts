import { z } from 'zod'
import { requireSession } from '@/lib/auth/guard'
import { db } from '@/lib/db'
import { nextRunAt } from '@/lib/flow/schedule'

const Body = z.object({
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(4000),
  templateSlug: z.string().trim().min(1),
  targetFolderName: z.string().trim().max(120).optional(),
  scheduleWeekday: z.number().int().min(0).max(6).default(1),
  scheduleHour: z.number().int().min(0).max(23).default(9),
  enabled: z.boolean().default(true),
})

/** 현재 워크스페이스의 FLOW 목록 + 최근 실행. */
export async function GET() {
  const authed = await requireSession()
  if (!authed) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (!authed.claims.ws) return Response.json({ flows: [] })

  const flows = await db.flowTask.findMany({
    where: { workspaceId: authed.claims.ws, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: { runs: { orderBy: { startedAt: 'desc' }, take: 5 } },
    take: 100,
  })
  return Response.json({ flows })
}

/** FLOW 등록. 템플릿 실존 확인 후 다음 실행 시각을 계산해 둔다. */
export async function POST(req: Request) {
  const authed = await requireSession()
  if (!authed) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (!authed.claims.ws) return Response.json({ error: '워크스페이스가 필요합니다' }, { status: 400 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'invalid body' }, { status: 400 })
  }
  const d = parsed.data

  const template = await db.page.findFirst({
    where: { slug: d.templateSlug, deletedAt: null },
    select: { slug: true },
  })
  if (!template) return Response.json({ error: `템플릿 문서가 없습니다: ${d.templateSlug}` }, { status: 400 })

  const flow = await db.flowTask.create({
    data: {
      userId: authed.user.id,
      workspaceId: authed.claims.ws,
      title: d.title,
      prompt: d.prompt,
      templateSlug: d.templateSlug,
      targetFolderName: d.targetFolderName ?? null,
      scheduleWeekday: d.scheduleWeekday,
      scheduleHour: d.scheduleHour,
      enabled: d.enabled,
      nextRunAt: d.enabled ? nextRunAt(d.scheduleWeekday, d.scheduleHour, new Date()) : null,
    },
  })
  return Response.json(flow, { status: 201 })
}
