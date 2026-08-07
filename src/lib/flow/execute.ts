import { db } from '@/lib/db'
import { runFlow } from './run'
import { nextRunAt } from './schedule'
import type { FlowTask } from '@prisma/client'

/**
 * FLOW 한 건 실행 — FlowRun 이력을 남기고, 성공/실패와 무관하게 다음 실행 시각을 갱신한다.
 * 수동 실행(run API)과 스케줄 실행(tick)이 같이 쓴다.
 */
export async function executeFlow(flow: FlowTask, trigger: 'manual' | 'schedule') {
  const run = await db.flowRun.create({
    data: { flowId: flow.id, trigger },
    select: { id: true },
  })

  try {
    const result = await runFlow({
      templateSlug: flow.templateSlug,
      instruction: flow.prompt,
      targetFolderId: flow.targetFolderId,
      targetFolderName: flow.targetFolderName,
    })
    await db.flowRun.update({
      where: { id: run.id },
      data: { status: 'done', resultSlug: result.slug, finishedAt: new Date() },
    })
    return { runId: run.id, status: 'done' as const, resultSlug: result.slug }
  } catch (e) {
    await db.flowRun.update({
      where: { id: run.id },
      data: { status: 'error', error: (e as Error).message, finishedAt: new Date() },
    })
    return { runId: run.id, status: 'error' as const, error: (e as Error).message }
  } finally {
    await db.flowTask.update({
      where: { id: flow.id },
      data: {
        lastRunAt: new Date(),
        nextRunAt: flow.enabled ? nextRunAt(flow.scheduleWeekday, flow.scheduleHour, new Date()) : null,
      },
    })
  }
}
