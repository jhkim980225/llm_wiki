/**
 * 맨 `<a>`에 넣을 위키 주소를 만든다. I/O 없는 순수 모듈.
 *
 * Next의 basePath는 라우터(`<Link>`·`router.push`)와 에셋에만 접두사를 붙인다 —
 * 클릭 인터셉터가 받아주는 좌클릭은 멀쩡하지만, Ctrl+클릭·가운데클릭·"링크 주소 복사"는
 * 브라우저가 href를 그대로 쓰므로 basePath 없는 주소로 나간다(실측: 회사 랜딩 페이지로 떨어짐).
 * next.config.ts의 BASE_PATH·BasePathFetch의 BASE와 값이 같아야 한다.
 */
const BASE = '/graphwiki'

/** slug의 각 경로 조각만 인코딩한다 — 슬래시는 경로 구분자로 살린다. */
export function wikiHref(slug: string): string {
  return `${BASE}/wiki/` + slug.split('/').map(encodeURIComponent).join('/')
}

/**
 * 클릭 인터셉터가 `router.push`에 넘기기 전 basePath를 벗긴다.
 * 라우터는 basePath를 스스로 붙이므로, href에 든 것을 그대로 넘기면
 * `/graphwiki/graphwiki/…`가 된다(실측).
 */
export function stripBasePath(href: string): string {
  if (href === BASE) return '/'
  return href.startsWith(`${BASE}/`) ? href.slice(BASE.length) : href
}
