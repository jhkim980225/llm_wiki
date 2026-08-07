/**
 * FLOW 주간 스케줄 계산. 사용자는 "월요일 9시"처럼 한국 시간으로 생각하므로
 * KST(+9, DST 없음) 기준으로 다음 실행 시각을 구한다. I/O 없음.
 */
const KST_MS = 9 * 60 * 60 * 1000

/** from 이후(초과)의 가장 가까운 `weekday요일 hour시(KST)` UTC 시각. */
export function nextRunAt(weekday: number, hour: number, from: Date): Date {
  const kst = new Date(from.getTime() + KST_MS)
  const candidate = new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), hour, 0, 0, 0),
  )
  let addDays = (weekday - candidate.getUTCDay() + 7) % 7
  if (addDays === 0 && candidate.getTime() <= kst.getTime()) addDays = 7
  candidate.setUTCDate(candidate.getUTCDate() + addDays)
  return new Date(candidate.getTime() - KST_MS)
}
