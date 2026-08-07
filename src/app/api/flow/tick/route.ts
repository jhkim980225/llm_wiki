import { db } from '@/lib/db'
import { executeFlow } from '@/lib/flow/execute'

/** due 작업이 여러 개면 순차 실행 — 하나가 2~4분이라 넉넉히. */
export const maxDuration = 600

/**
 * 스케줄 심장박동. k8s CronJob이 10분마다 부른다(사용자 세션 없음 —
 * 미들웨어 matcher에서 제외되고, 대신 토큰으로 보호한다).
 * nextRunAt이 지난 활성 FLOW를 순차 실행한다.
 */
export async function POST(req: Request) {
  const token = process.env.FLOW_TICK_TOKEN
  if (!token || req.headers.get('x-flow-token') !== token) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const due = await db.flowTask.findMany({
    where: { deletedAt: null, enabled: true, nextRunAt: { lte: new Date() } },
    orderBy: { nextRunAt: 'asc' },
    take: 10,
  })

  const results = []
  for (const flow of due) {
    // 실행 직전에 nextRunAt을 미리 미래로 밀어 둔다 — tick이 겹쳐 와도 이중 실행 방지.
    const claimed = await db.flowTask.updateMany({
      where: { id: flow.id, nextRunAt: flow.nextRunAt },
      data: { nextRunAt: null },
    })
    if (claimed.count === 0) continue
    results.push({ id: flow.id, title: flow.title, ...(await executeFlow(flow, 'schedule')) })
  }
  return Response.json({ ran: results.length, results })
}
