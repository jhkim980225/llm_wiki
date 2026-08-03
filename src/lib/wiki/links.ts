/** [[wiki-link]] 문법 매칭. `]`를 포함하지 않는 내용만 링크로 본다. */
export const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g

/** [[slug]] / [[slug|표시명]]의 내부 텍스트에서 slug 부분만 돌려준다. */
export function extractWikiSlug(inner: string): string {
  const pipe = inner.indexOf('|')
  return (pipe >= 0 ? inner.slice(0, pipe) : inner).trim()
}

/** content 안의 모든 아웃링크 slug를 등장 순서대로, 중복 없이 반환한다. */
export function parseOutLinks(content: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of content.matchAll(WIKI_LINK_RE)) {
    const slug = extractWikiSlug(m[1])
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    out.push(slug)
  }
  return out
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
