/**
 * ```wbs 펜스 → WBS 표와 간트가 한 판에 붙은 격자.
 *
 * 표 따로 간트 따로 두면 같은 작업을 두 번 읽어야 한다. 왼쪽은 작업 정보,
 * 오른쪽은 같은 행에 그 작업의 막대 — 한 줄로 읽힌다(WBS 간트 관례).
 *
 * 입력은 사람이 쓰던 GFM 표 그대로다(`parseWbsMarkdown`). 문서에 남는 것도
 * 그 표라 편집기·검색·LLM 모두 평범한 표로 다룰 수 있다 — 격자는 표시 형태다.
 * I/O 없는 순수 모듈.
 */
import { parseWbsMarkdown, type ParsedTask } from '@/lib/wbs/markdown'

/** 주말은 열에서 뺀다 — 주간 업무는 월~금이고, 넣으면 폭만 40% 늘어난다. */
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']
/** 폭주 방지. 넘어가면 뒤를 자르고 마지막 열에 표시한다. */
const MAX_COLS = 90

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const day = (iso: string) => new Date(iso + 'T00:00:00Z')
const iso = (d: Date) => d.toISOString().slice(0, 10)

/**
 * 날짜 칸이 실제 날짜인지. 양식 문서는 `YYYY-MM-DD` 같은 자리표시자를 그대로 두므로
 * 이 검사가 없으면 Invalid Date가 toISOString에서 터진다.
 * 못 읽는 날짜는 막대 없이 글자만 보여 준다 — 양식이 표로는 그대로 읽힌다.
 */
const dated = (s: string | null): s is string =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(day(s).getTime())

/** 시작 + 기간(영업일)으로 종료일을 채운다 — 표에 종료일이 비어 있을 때. */
function endOf(t: ParsedTask): string | null {
  if (t.endDate) return t.endDate
  if (!dated(t.startDate) || !t.durationDays) return null
  const d = day(t.startDate)
  let left = t.durationDays - 1
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--
  }
  return iso(d)
}

/** 대분류 행 — 코드에 점이 없고 날짜가 없는 줄('1 | 생산'). */
const isGroup = (t: ParsedTask) => !dated(t.startDate) && !!t.wbsCode && !t.wbsCode.includes('.')

/** 대분류 번호(1,2,3…)로 색을 돌린다. 종류 색과 같은 6묶음 팔레트. */
const groupClass = (code: string | null) => {
  const n = parseInt((code ?? '').split('.')[0], 10)
  return Number.isFinite(n) && n > 0 ? `g${((n - 1) % 6) + 1}` : 'g1'
}

function columns(tasks: ParsedTask[]): string[] {
  const starts = tasks.map((t) => t.startDate).filter(dated)
  const ends = tasks.map(endOf).filter(dated)
  if (!starts.length) return []
  const from = day(starts.reduce((a, b) => (a < b ? a : b)))
  const toIso = [...starts, ...ends].reduce((a, b) => (a > b ? a : b))
  const out: string[] = []
  for (const d = from; iso(d) <= toIso && out.length < MAX_COLS; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(iso(d))
  }
  return out
}

/** 열을 주 단위로 묶는다 — 위쪽 헤더의 colspan. */
function weekSpans(cols: string[]): { label: string; span: number }[] {
  const out: { label: string; span: number }[] = []
  let key = ''
  for (const c of cols) {
    const d = day(c)
    // 그 주 월요일 기준으로 묶는다 (일요일=0을 주의 끝으로 본다)
    const monday = new Date(d)
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
    const k = iso(monday)
    if (k === key) out[out.length - 1].span++
    else {
      key = k
      // 레퍼런스(WBS 간트)의 'Week 1·2·3'처럼 차트 시작 기준 주차로 센다.
      // 날짜만 쓰면 몇 주짜리 일정인지 한눈에 안 들어온다.
      out.push({
        label: `${out.length + 1}주차 · ${monday.getUTCMonth() + 1}/${monday.getUTCDate()}`,
        span: 1,
      })
    }
  }
  return out
}

/** 맨 위 단 — 레퍼런스의 'Phase One/Two' 자리. 데이터에 단계가 없으므로 달로 묶는다. */
function monthSpans(cols: string[]): { label: string; span: number }[] {
  const out: { label: string; span: number }[] = []
  let key = ''
  for (const c of cols) {
    const d = day(c)
    const k = `${d.getUTCFullYear()}-${d.getUTCMonth()}`
    if (k === key) out[out.length - 1].span++
    else {
      key = k
      out.push({ label: `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월`, span: 1 })
    }
  }
  return out
}

const LEFT_COLS = 7

export function wbsGridToHtml(md: string): string {
  const tasks = parseWbsMarkdown(md)
  if (!tasks.length) return ''
  const cols = columns(tasks)

  const months = monthSpans(cols)
    .map((m) => `<th class="c-month" colspan="${m.span}">${esc(m.label)}</th>`)
    .join('')
  const weeks = weekSpans(cols)
    .map((w) => `<th class="c-week" colspan="${w.span}">${esc(w.label)}</th>`)
    .join('')
  const days = cols
    .map((c) => {
      const d = day(c)
      return `<th class="c-day"><b>${WEEKDAY[d.getUTCDay()]}</b><i>${d.getUTCDate()}</i></th>`
    })
    .join('')

  const rows = tasks
    .map((t) => {
      const g = groupClass(t.wbsCode)
      const end = endOf(t)
      if (isGroup(t)) {
        const filler = cols.map(() => '<td class="c-cell"></td>').join('')
        return (
          `<tr class="grp ${g}"><td class="c-code">${esc(t.wbsCode ?? '')}</td>` +
          `<td colspan="${LEFT_COLS - 1}">${esc(t.title)}</td>${filler}</tr>`
        )
      }
      const span = dated(t.startDate) && dated(end) ? { from: t.startDate, to: end } : null
      const first = span ? cols.find((x) => x >= span.from) : undefined
      const last = span ? [...cols].reverse().find((x) => x <= span.to) : undefined
      const cells = cols
        .map((c) => {
          if (!span || c < span.from || c > span.to) return '<td class="c-cell"></td>'
          return `<td class="c-cell on${c === first ? ' s' : ''}${c === last ? ' e' : ''}"></td>`
        })
        .join('')
      // 진행률은 인라인 style 대신 구간 클래스로 — 정화기(DOMPurify) 설정에 기대지 않는다.
      const pct = t.progress === null ? null : Math.max(0, Math.min(100, t.progress))
      const prog =
        pct === null
          ? '<td class="c-num"></td>'
          : `<td class="c-num"><span class="pct ${pct >= 100 ? 'done' : pct >= 50 ? 'high' : pct > 0 ? 'low' : 'zero'}">${pct}%</span></td>`
      return (
        `<tr class="${g}">` +
        `<td class="c-code">${esc(t.wbsCode ?? '')}</td>` +
        `<td class="c-title">${esc(t.title)}</td>` +
        `<td class="c-owner">${esc(t.assignee ?? '')}</td>` +
        `<td class="c-date">${esc(t.startDate ?? '')}</td>` +
        `<td class="c-date">${esc(end ?? '')}</td>` +
        `<td class="c-num">${t.durationDays ?? ''}</td>` +
        prog +
        cells +
        '</tr>'
      )
    })
    .join('')

  // 헤더 3단 — 달 / 주차 / 요일·일자. 레퍼런스(Phase → Week → M T W R F)와 같은 구성이다.
  // 날짜 열이 없는 문서(자리표시자만 있는 양식)는 왼쪽 열만 한 줄로 낸다.
  const tiers = cols.length > 0 ? 3 : 1
  const left = (cls: string, label: string) =>
    `<th class="${cls}" rowspan="${tiers}">${label}</th>`

  return (
    '\n\n<div class="wbs-grid"><table>' +
    '<thead><tr>' +
    left('c-code', 'WBS') +
    left('c-title', '업무') +
    left('c-owner', '담당') +
    left('c-date', '시작') +
    left('c-date', '종료') +
    left('c-num', '기간') +
    left('c-num', '진행') +
    months +
    '</tr>' +
    (cols.length > 0 ? `<tr>${weeks}</tr><tr>${days}</tr>` : '') +
    '</thead>' +
    `<tbody>${rows}</tbody>` +
    '</table></div>\n\n'
  )
}

const FENCE_RE = /```wbs[ \t]*\r?\n([\s\S]*?)```/g

/** 본문의 ```wbs 펜스를 격자로 바꾼다. 마크다운 파싱 전에 돈다. */
export function wbsBlocksToHtml(content: string): string {
  return content.replace(FENCE_RE, (_whole, body: string) => wbsGridToHtml(body))
}
