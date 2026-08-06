import { normalizeSlug } from './slug'

/**
 * [[wiki-link]] 문법 매칭.
 * 표시명에 단일 대괄호를 허용한다 — 이메일 제목 유래 라벨이 "[성진] …"처럼
 * 대괄호로 시작해서, `]`를 전부 금지하면 그 링크가 통째로 평문 노출된다(실측).
 * `]]`(닫힘)만 링크의 끝으로 본다.
 */
export const WIKI_LINK_RE = /\[\[((?:[^\]]|\](?!\]))+)\]\]/g

/** [[slug]] / [[slug|표시명]]의 내부 텍스트에서 slug 부분만 돌려준다. */
export function extractWikiSlug(inner: string): string {
  const pipe = inner.indexOf('|')
  return (pipe >= 0 ? inner.slice(0, pipe) : inner).trim()
}

/**
 * content 안의 모든 아웃링크 slug를 등장 순서대로, 중복 없이 반환한다.
 * 사용자는 [[문서 제목]]처럼 제목으로 태깅하므로 slug 규칙(공백→하이픈, 소문자)으로
 * 정규화해서 돌려준다 — 저장되는 outLinks가 늘 실제 slug와 비교 가능해진다.
 */
export function parseOutLinks(content: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of content.matchAll(WIKI_LINK_RE)) {
    const slug = normalizeSlug(extractWikiSlug(m[1]))
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    out.push(slug)
  }
  return out
}

/**
 * LLM이 생성한 본문의 [[링크]]를 실존 문서 목록과 대조해 정리한다.
 *
 * - 실존 slug를 가리키는 완결 링크만 남긴다
 * - slug 자리가 실제로는 **제목**(파일명 등)인 링크는 byTitle(제목→slug)로 찾아
 *   [[slug|제목]]으로 고쳐 잇는다 — LLM이 소스 접두사(seunghoon/…)를 모르기 때문
 * - 그래도 못 찾으면 표시명 평문으로 바꾼다 (죽은 링크 방지)
 * - 짝을 잃은 `[[`(생성이 중간에 잘린 경우)는 그 줄의 대괄호를 걷어낸다
 */
export function sanitizeWikiLinks(
  content: string,
  validSlugs: Set<string>,
  byTitle: Map<string, string> = new Map(),
): string {
  const resolved = content.replace(WIKI_LINK_RE, (whole, inner: string) => {
    const raw = extractWikiSlug(inner)
    const slug = normalizeSlug(raw)
    if (validSlugs.has(slug)) return whole
    const pipe = inner.indexOf('|')
    const display = (pipe >= 0 ? inner.slice(pipe + 1) : inner).trim()
    const titled = byTitle.get(raw) ?? byTitle.get(display)
    if (titled) return `[[${titled}|${display}]]`
    return display
  })

  // 남은 링크는 전부 유효하다. 줄 안에서 [[와 ]] 개수가 어긋나면 잘린 링크 잔재이므로
  // 그 줄의 위키 대괄호를 통째로 벗긴다 (유효 링크가 같은 줄에 있으면 같이 벗겨지지만,
  // 잘린 텍스트가 링크로 오인되는 것보다 낫다).
  return resolved
    .split('\n')
    .map((line) => {
      const opens = (line.match(/\[\[/g) ?? []).length
      const closes = (line.match(/\]\]/g) ?? []).length
      return opens === closes ? line : line.replaceAll('[[', '').replaceAll(']]', '')
    })
    .join('\n')
}

export type Span = { start: number; end: number }

/**
 * 링크를 주입하면 안 되는 구간을 모은다. 펜스 코드블록, 인라인 코드,
 * 기존 [[위키링크]], 마크다운 링크/이미지, 참조링크와 그 정의, 자동링크.
 * 함께 수집한 linkedSlugs로 "이미 이 slug로 링크됨"을 한 번의 스캔으로 판정한다.
 */
export function computeForbiddenSpans(s: string): { spans: Span[]; linkedSlugs: Set<string> } {
  const spans: Span[] = []
  const linkedSlugs = new Set<string>()

  const push = (start: number, end: number) => {
    if (end > start) spans.push({ start, end })
  }

  // 1) 펜스 코드블록 — 여는 펜스와 같은 문자로 닫힐 때까지. 닫히지 않으면 문서 끝까지.
  const fence = /^[ \t]*(```+|~~~+)[^\n]*$/gm
  const fenceRanges: Span[] = []
  let fenceMatch: RegExpExecArray | null
  while ((fenceMatch = fence.exec(s)) !== null) {
    const marker = fenceMatch[1][0]
    const start = fenceMatch.index
    const afterOpen = fenceMatch.index + fenceMatch[0].length
    const closeRe = new RegExp(marker === '`' ? '^[ \t]*```+[ \t]*$' : '^[ \t]*~~~+[ \t]*$', 'gm')
    closeRe.lastIndex = afterOpen
    const close = closeRe.exec(s)
    const end = close ? close.index + close[0].length : s.length
    fenceRanges.push({ start, end })
    push(start, end)
    fence.lastIndex = end
  }
  const inFence = (i: number) => fenceRanges.some((r) => r.start <= i && i < r.end)

  // 2) 인라인 코드 — 같은 길이의 백틱 런끼리 짝짓는다.
  const tick = /(`+)(?:[^`]|[^`][\s\S]*?)\1/g
  let t: RegExpExecArray | null
  while ((t = tick.exec(s)) !== null) {
    if (inFence(t.index)) continue
    push(t.index, t.index + t[0].length)
  }

  // 3) 기존 위키링크
  for (const m of s.matchAll(WIKI_LINK_RE)) {
    const at = m.index
    push(at, at + m[0].length)
    const slug = extractWikiSlug(m[1])
    if (slug && !/\s/.test(slug)) linkedSlugs.add(slug)
  }

  // 4) 인라인 링크 / 이미지 / 참조링크 / 참조정의 / 자동링크
  const patterns = [
    /!?\[[^\]]*\]\([^)]*\)/g,
    /!?\[[^\]]*\]\[[^\]]*\]/g,
    /^[ \t]*\[[^\]]+\]:[^\n]*$/gm,
    /<[a-zA-Z][a-zA-Z0-9+.-]*:[^\s>]*>/g,
  ]
  for (const re of patterns) {
    for (const m of s.matchAll(re)) push(m.index, m.index + m[0].length)
  }

  spans.sort((a, b) => a.start - b.start || a.end - b.end)
  return { spans, linkedSlugs }
}

/** [pos, end) 구간이 금지 구간과 겹치는지. */
export function spanContains(spans: Span[], pos: number, end: number): boolean {
  return spans.some((sp) => pos < sp.end && sp.start < end)
}

export type LinkRef = { slug: string; matchText: string }

const isAsciiWord = (ch: string) => /[A-Za-z0-9_]/.test(ch)

/** matchText가 ASCII 문자/숫자로 시작하거나 끝나면 단어 경계를 따져야 한다. */
function hasAsciiEdge(s: string): boolean {
  return s.length > 0 && (isAsciiWord(s[0]) || isAsciiWord(s[s.length - 1]))
}

/** pos 직전과 end 위치가 ASCII 단어 문자가 아닌지. CJK는 경계로 취급된다. */
function hasWordBoundary(s: string, pos: number, end: number): boolean {
  const before = pos > 0 ? s[pos - 1] : ''
  const after = end < s.length ? s[end] : ''
  return !isAsciiWord(before) && !isAsciiWord(after)
}

/** 금지 구간을 피하고 필요한 경우 단어 경계를 지키는 첫 출현 위치. 없으면 -1. */
function findFirstSafeMatch(haystack: string, needle: string, forbidden: Span[]): number {
  const needBoundary = hasAsciiEdge(needle)
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) return -1
    const end = at + needle.length
    if (!spanContains(forbidden, at, end) && (!needBoundary || hasWordBoundary(haystack, at, end))) {
      return at
    }
    from = at + 1
  }
}

/**
 * 각 ref의 첫 번째 안전한 출현을 [[slug|matchText]]로 감싼다.
 * 이미 해당 slug로 링크된 ref와 selfSlug를 가리키는 ref는 건너뛴다.
 * 긴 matchText를 먼저 처리해 짧은 것이 긴 것을 잘라먹지 않게 한다.
 */
export function linkifyContent(
  content: string,
  refs: LinkRef[],
  selfSlug: string,
): { content: string; changed: boolean } {
  let out = content
  let changed = false
  let { spans, linkedSlugs } = computeForbiddenSpans(out)

  const ordered = [...refs]
    .filter((r) => r.slug && r.matchText && r.slug !== selfSlug)
    .sort((a, b) => b.matchText.length - a.matchText.length || a.slug.localeCompare(b.slug))

  for (const ref of ordered) {
    if (linkedSlugs.has(ref.slug)) continue
    const at = findFirstSafeMatch(out, ref.matchText, spans)
    if (at < 0) continue

    const replacement = '[[' + ref.slug + '|' + ref.matchText + ']]'
    const end = at + ref.matchText.length
    out = out.slice(0, at) + replacement + out.slice(end)
    changed = true

    // 주입으로 뒤쪽 오프셋이 밀렸으므로 금지 구간을 다시 계산한다.
    // ponytail: 전체 재계산이다. refs가 수백 개로 늘면 span 시프트로 바꾼다.
    const recomputed = computeForbiddenSpans(out)
    spans = recomputed.spans
    linkedSlugs = recomputed.linkedSlugs
  }

  return { content: out, changed }
}

/** rename 시 [[oldSlug]] / [[oldSlug|표시명]]의 slug 부분만 newSlug로 바꾼다. */
export function rewriteWikiLinks(content: string, oldSlug: string, newSlug: string): string {
  return content.replace(WIKI_LINK_RE, (whole, inner: string) => {
    const pipe = inner.indexOf('|')
    const slug = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim()
    if (slug !== oldSlug) return whole
    return pipe >= 0 ? '[[' + newSlug + '|' + inner.slice(pipe + 1) + ']]' : '[[' + newSlug + ']]'
  })
}
