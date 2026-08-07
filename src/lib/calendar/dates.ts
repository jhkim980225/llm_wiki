/**
 * 문서에서 날짜·기간을 뽑는다 — 캘린더에 휴가·주간업무 문서를 얹기 위한 것.
 * I/O 없는 순수 모듈. 문서 조회는 Route Handler가 한다.
 */

/** `[[slug|표시명]]` → 표시명, `[[slug]]` → slug. 위키링크가 날짜를 쪼개 놓는 것을 되돌린다. */
export function stripLinks(text: string): string {
  return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, slug, label) => label ?? slug)
}

export type DateRange = { start: string; end: string }

/**
 * 본문에서 첫 기간(YYYY-MM-DD ~ YYYY-MM-DD) 또는 첫 단일 날짜를 뽑는다.
 *
 * "기간"이라는 말이 든 줄이 있으면 거기서 먼저 찾는다 — 휴가신청서는 작성일이
 * 기간보다 먼저 나와서(실측: 작성일 08-07을 휴가일로 오인) 첫 날짜가 답이 아니다.
 *
 * linkify가 연도를 `[[kakao/2026년|2026년]]`으로 걸어 "2026년-08-14" 같은 변형이
 * 실재한다(프로덕션 휴가신청서 실측) — "년" 표기를 허용한다.
 * 범위 구분자는 ~ 또는 – 또는 "부터".
 */
export function extractDateRange(text: string): DateRange | null {
  const stripped = stripLinks(text)
  const periodLine = stripped.split('\n').find((l) => l.includes('기간'))
  if (periodLine) {
    const fromLine = scan(periodLine)
    if (fromLine) return fromLine
  }
  return scan(stripped)
}

function scan(t: string): DateRange | null {
  const DATE = /(\d{4})(?:년)?[-.\s]?(\d{2})[-.](\d{2})/g

  const found: { date: string; index: number }[] = []
  for (let m = DATE.exec(t); m; m = DATE.exec(t)) {
    found.push({ date: `${m[1]}-${m[2]}-${m[3]}`, index: m.index })
    if (found.length >= 2) {
      // 두 날짜 사이가 범위 구분자면 기간으로 본다 (사이 20자 이내).
      const between = t.slice(found[0].index, found[1].index)
      if (/[~–]|부터/.test(between) && between.length < 40) {
        const [a, b] = [found[0].date, found[1].date].sort()
        return { start: a, end: b }
      }
      break
    }
  }
  return found.length > 0 ? { start: found[0].date, end: found[0].date } : null
}

/** 기간이 [from, to] 창과 겹치는가. 문자열 비교로 충분하다(YYYY-MM-DD). */
export function overlaps(range: DateRange, from: string, to: string): boolean {
  return range.start <= to && range.end >= from
}

/** 기간을 일자 목록으로 편다. 캘린더가 칸마다 찍을 때 쓴다. 상한으로 폭주를 막는다. */
export function expandDays(range: DateRange, max = 62): string[] {
  const out: string[] = []
  const d = new Date(range.start + 'T00:00:00')
  const end = new Date(range.end + 'T00:00:00')
  while (d <= end && out.length < max) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    )
    d.setDate(d.getDate() + 1)
  }
  return out
}
