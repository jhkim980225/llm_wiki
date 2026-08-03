import { WIKI_LINK_RE } from './links'

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/**
 * [[slug]] / [[slug|표시명]]을 앵커로 바꾼다. 마크다운 파싱 **전에** 돌린다.
 * 존재하지 않는 slug에는 dead 클래스를 붙여 UI가 붉은 링크로 표시하게 한다.
 * slug와 표시명 모두 사용자 입력이므로 반드시 이스케이프한다 (속성 탈출 방지).
 */
export function wikiLinksToHtml(content: string, existingSlugs: Set<string>): string {
  return content.replace(WIKI_LINK_RE, (_whole, inner: string) => {
    const pipe = inner.indexOf('|')
    const slug = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim()
    const display = pipe >= 0 ? inner.slice(pipe + 1).trim() : slug
    const dead = existingSlugs.has(slug) ? '' : ' dead'
    const href = encodeURI('/wiki/' + slug).replace(/"/g, '%22')
    return `<a class="wikilink${dead}" href="${escapeHtml(href)}">${escapeHtml(display)}</a>`
  })
}
