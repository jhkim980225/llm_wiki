/**
 * WBS 마크다운 표 ↔ 태스크 구조 변환.
 * 표 헤더를 키워드로 느슨하게 매핑한다(WBS/업무/담당/시작/종료/기간) — 붙여넣는 표가
 * 조금씩 달라도 먹히게.
 */
export type ParsedTask = {
  wbsCode: string | null
  title: string
  assignee: string | null
  startDate: string | null
  endDate: string | null
  durationDays: number | null
}

/** 'MM/DD' 또는 'YYYY-MM-DD' / 'YYYY.MM.DD' 등을 'YYYY-MM-DD'로. 실패하면 원문 유지. */
export function normalizeDate(raw: string | null | undefined, defaultYear = 2026): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[-./](\d{1,2})$/) // MM/DD → 연도 보충
  if (m) return `${defaultYear}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return s
}

const cols = (line: string): string[] =>
  line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim())

const isSep = (line: string): boolean => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-')

function fieldOf(header: string): keyof ParsedTask | null {
  const h = header.toLowerCase()
  if (h.includes('wbs') || h === '#' || h === 'no') return 'wbsCode'
  if (h.includes('담당')) return 'assignee'
  if (h.includes('시작')) return 'startDate'
  if (h.includes('종료') || h.includes('마감')) return 'endDate'
  if (h.includes('기간') || h.includes('일수')) return 'durationDays'
  if (h.includes('업무') || h.includes('내용') || h.includes('작업') || h.includes('task') || h.includes('title'))
    return 'title'
  return null
}

/** 마크다운 본문에서 첫 GFM 표를 찾아 태스크로 파싱한다. 표가 없으면 빈 배열. */
export function parseWbsMarkdown(md: string, defaultYear = 2026): ParsedTask[] {
  const lines = md.split(/\r?\n/)
  let headerIdx = -1
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].includes('|') && isSep(lines[i + 1])) {
      headerIdx = i
      break
    }
  }
  if (headerIdx < 0) return []

  const headers = cols(lines[headerIdx])
  const map = headers.map(fieldOf)
  const tasks: ParsedTask[] = []

  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i]
    if (!line.includes('|')) break // 표 끝
    if (isSep(line)) continue
    const cells = cols(line)
    const t: ParsedTask = {
      wbsCode: null,
      title: '',
      assignee: null,
      startDate: null,
      endDate: null,
      durationDays: null,
    }
    cells.forEach((val, idx) => {
      const field = map[idx]
      if (!field || !val) return
      if (field === 'durationDays') {
        const n = parseInt(val.replace(/[^\d]/g, ''), 10)
        t.durationDays = Number.isFinite(n) ? n : null
      } else if (field === 'startDate' || field === 'endDate') {
        t[field] = normalizeDate(val, defaultYear)
      } else {
        t[field] = val
      }
    })
    if (t.title) tasks.push(t)
  }
  return tasks
}

/** 태스크를 GFM 표 마크다운으로. (export) */
export function tasksToMarkdown(
  tasks: Pick<ParsedTask, 'wbsCode' | 'title' | 'assignee' | 'startDate' | 'endDate' | 'durationDays'>[],
): string {
  const head = '| WBS | 업무내용 | 담당자 | 시작일 | 종료일 | 기간(일) |'
  const sep = '| --- | --- | --- | --- | --- | --- |'
  const rows = tasks.map(
    (t) =>
      `| ${t.wbsCode ?? ''} | ${t.title} | ${t.assignee ?? ''} | ${t.startDate ?? ''} | ${t.endDate ?? ''} | ${t.durationDays ?? ''} |`,
  )
  return [head, sep, ...rows].join('\n')
}

/** start~end(포함) 날짜 목록. 파싱 불가/역전이면 빈 배열. cap로 폭주 방지. */
export function dateRange(start: string | null, end: string | null, cap = 45): string[] {
  if (!start || !end) return []
  const s = new Date(start + 'T00:00:00Z')
  const e = new Date(end + 'T00:00:00Z')
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return []
  const out: string[] = []
  for (let d = s; d <= e && out.length < cap; d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}
