import { requireSession } from '@/lib/auth/guard'
import { db } from '@/lib/db'
import { fillPlan, fillTotal } from '@/lib/wbs/fill'

// LLM 배치 — 백그라운드로 돌지만 라우트 자체는 즉시 반환한다.
export const maxDuration = 600

/** 재실행 허용 임계 — running인데 이보다 오래 안 끝났으면 죽은 job으로 보고 다시 시작. */
const STALE_MS = 15 * 60 * 1000

async function ownedPlan(id: string) {
  const authed = await requireSession()
  if (!authed || !authed.claims.ws) return null
  const plan = await db.wbsPlan.findFirst({
    where: { id, userId: authed.user.id, workspaceId: authed.claims.ws },
    select: { id: true },
  })
  return plan ? authed : null
}

/** 백그라운드 실행 — 진행률을 job에 계속 쓴다. 서버가 살아있는 동안 이어서 돈다. */
async function runFill(planId: string) {
  try {
    await fillPlan(planId, {
      useRag: true,
      onProgress: async (done, total) => {
        await db.wbsFillJob.update({ where: { planId }, data: { done, total } }).catch(() => {})
      },
    })
    await db.wbsFillJob.update({ where: { planId }, data: { status: 'done', finishedAt: new Date() } })
    await db.wbsPlan.update({ where: { id: planId }, data: { updatedAt: new Date() } })
  } catch (e) {
    await db.wbsFillJob
      .update({ where: { planId }, data: { status: 'error', error: (e as Error).message, finishedAt: new Date() } })
      .catch(() => {})
  }
}

/** 채우기 시작(비동기). 이미 도는 job이 있으면 409. body 없음. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!(await ownedPlan(id))) return Response.json({ error: 'not found' }, { status: 404 })

  const existing = await db.wbsFillJob.findUnique({ where: { planId: id } })
  if (existing?.status === 'running' && Date.now() - existing.startedAt.getTime() < STALE_MS) {
    return Response.json({ error: '이미 채우는 중입니다', status: 'running' }, { status: 409 })
  }

  const tasks = await db.wbsTask.findMany({
    where: { planId: id },
    select: { id: true, title: true, assignee: true, startDate: true, endDate: true },
  })
  const total = fillTotal(tasks)

  await db.wbsFillJob.upsert({
    where: { planId: id },
    create: { planId: id, status: 'running', total, done: 0 },
    update: { status: 'running', total, done: 0, error: null, startedAt: new Date(), finishedAt: null },
  })

  void runFill(id) // 응답을 막지 않는다 — 진행상태는 GET으로 폴링
  return Response.json({ ok: true, status: 'running', total }, { status: 202 })
}

/** 채우기 진행상태. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!(await ownedPlan(id))) return Response.json({ error: 'not found' }, { status: 404 })
  const job = await db.wbsFillJob.findUnique({ where: { planId: id } })
  return Response.json({ job })
}
