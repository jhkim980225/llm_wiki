import { z } from 'zod'
import { db } from '@/lib/db'
import { generateJson } from '@/lib/llm/json'
import { askSourceRag, hasRagApi } from '@/lib/rag/source-rag'
import { QUERY_SOURCES } from '@/lib/ontology/source'
import { dateRange } from './markdown'

const DaySchema = z.object({
  date: z.string(),
  summary: z.string(),
  detail: z.string().default(''),
})
const FillSchema = z.object({ days: z.array(DaySchema) })

type TaskLite = {
  id: string
  title: string
  assignee: string | null
  startDate: string | null
  endDate: string | null
}

const RAG_CONTEXT_CHARS = 2500

/**
 * 플랜당 1회, 사내 데이터에서 근거를 끌어온다(베스트에포트). WBS 태스크 이름·담당자를
 * 질문으로 소스 RAG API에 물어 자연어 답을 합친다. 실패/무응답이면 빈 문자열.
 * 태스크마다 부르면 태스크×소스×수십초라, 여기서 한 번만 부른다.
 */
export async function buildRagContext(tasks: TaskLite[]): Promise<string> {
  const names = tasks.map((t) => t.title).slice(0, 20).join(', ')
  const assignees = [...new Set(tasks.map((t) => t.assignee).filter(Boolean))].join(', ')
  const question =
    `다음 업무들의 배경·관련 사내 정보(거래처·일정·담당)를 알려줘: ${names}` +
    (assignees ? ` / 담당자: ${assignees}` : '')

  const sources = QUERY_SOURCES.filter((s) => hasRagApi(s.id))
  const results = await Promise.all(sources.map((s) => askSourceRag(s.id, question)))
  const ctx = results
    .filter((r) => r.ok && r.answer)
    .map((r) => r.answer as string)
    .join('\n\n')
  return ctx.slice(0, RAG_CONTEXT_CHARS)
}

/**
 * 한 태스크의 기간을 일자별 세부 작업으로 채운다. 날짜는 여기서 계산해 LLM에 목록으로
 * 주고(모델이 날짜를 지어내지 않게), 모델은 각 날짜의 summary·detail만 쓴다.
 * ragContext가 있으면 근거로 참고시킨다. 기존 셀은 upsert로 덮는다. 반환: 채운 셀 수.
 */
export async function fillTask(task: TaskLite, ragContext = ''): Promise<number> {
  const dates = dateRange(task.startDate, task.endDate)
  if (dates.length === 0) return 0

  const result = await generateJson({
    schema: FillSchema,
    system:
      '너는 프로젝트 일정 플래너다. 주어진 업무를 날짜별 실행 계획으로 쪼갠다. ' +
      '반드시 주어진 날짜 목록만 사용하고, 각 날짜에 그날 할 일을 구체적으로 배정한다. ' +
      'summary는 한 줄(그날 핵심), detail은 markdown으로 그날 할 일·산출물을 적는다. 한국어로. ' +
      (ragContext
        ? '아래 "사내 참고"에 관련 사실이 있으면 근거로 반영하되, 없는 내용을 지어내지 마라.'
        : ''),
    prompt:
      `업무: ${task.title}\n` +
      (task.assignee ? `담당자: ${task.assignee}\n` : '') +
      `기간: ${task.startDate} ~ ${task.endDate}\n` +
      `채울 날짜(이 목록만 사용): ${dates.join(', ')}\n` +
      (ragContext ? `\n[사내 참고]\n${ragContext}\n` : '') +
      `\n형식: {"days":[{"date":"YYYY-MM-DD","summary":"...","detail":"..."}]}`,
    retries: 1,
  })

  const valid = new Set(dates)
  const rows = result.days.filter((d) => valid.has(d.date))
  if (rows.length === 0) return 0

  await db.$transaction(
    rows.map((d) =>
      db.scheduleEntry.upsert({
        where: { taskId_date: { taskId: task.id, date: d.date } },
        create: { taskId: task.id, date: d.date, summary: d.summary, detail: d.detail, source: 'llm' },
        update: { summary: d.summary, detail: d.detail, source: 'llm' },
      }),
    ),
  )
  return rows.length
}

/** 채울 셀 총수(진행률 표시용). */
export const fillTotal = (tasks: TaskLite[]): number =>
  tasks.reduce((n, t) => n + dateRange(t.startDate, t.endDate).length, 0)

/**
 * 플랜의 모든 태스크를 채운다. 태스크끼리 순차(소스 부하·순서 안정).
 * onProgress(doneCells, totalCells)로 진행률을 흘린다. useRag면 플랜당 1회 사내근거 결합.
 */
export async function fillPlan(
  planId: string,
  opts: { onProgress?: (done: number, total: number) => Promise<void> | void; useRag?: boolean } = {},
): Promise<{ tasks: number; entries: number }> {
  const tasks = await db.wbsTask.findMany({
    where: { planId },
    select: { id: true, title: true, assignee: true, startDate: true, endDate: true },
    orderBy: { sortOrder: 'asc' },
  })
  const total = fillTotal(tasks)
  const ragContext = opts.useRag ? await buildRagContext(tasks).catch(() => '') : ''

  let entries = 0
  let filled = 0
  for (const t of tasks) {
    const n = await fillTask(t, ragContext)
    if (n > 0) filled++
    entries += n
    if (opts.onProgress) await opts.onProgress(entries, total)
  }
  return { tasks: filled, entries }
}
