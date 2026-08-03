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
