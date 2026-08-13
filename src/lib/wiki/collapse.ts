/**
 * 렌더된 본문에서 특정 절(기본 '참고')을 접이식으로 바꾼다.
 *
 * 마크다운 단계가 아니라 파싱 뒤에 손대는 이유: `<details>`로 감싼 안쪽은
 * marked가 원시 HTML로 통과시켜 링크 목록이 글자로 남는다. 파싱이 끝난 다음
 * 같은 노드들을 옮기면 렌더 결과를 그대로 쓸 수 있다.
 *
 * DOM이 필요하므로 브라우저(또는 happy-dom)에서만 부른다.
 */
/**
 * 절의 끝은 **같은 급 이상의 제목**에서다. H3까지 끝으로 보면
 * '이 문서를 가리키는 관계'처럼 안에 `### 관계이름` 소제목을 둔 절이
 * 첫 소제목에서 잘려 아무것도 안 접힌다.
 */
const HEADING = new Set(['H1', 'H2'])

/** 기본 대상 — 근거 링크·역참조처럼 길고 훑어보기용인 절. */
const DEFAULT_TITLES = ['참고', '이 문서를 가리키는 관계']

export function collapseSections(html: string, titles: string[] = DEFAULT_TITLES): string {
  if (typeof document === 'undefined') return html
  const want = new Set(titles)

  const host = document.createElement('div')
  host.innerHTML = html

  for (const h of [...host.children]) {
    if (h.tagName !== 'H2' || !want.has((h.textContent ?? '').trim())) continue

    const details = document.createElement('details')
    const summary = document.createElement('summary')
    summary.textContent = (h.textContent ?? '').trim()
    details.append(summary)
    h.replaceWith(details)

    // 다음 제목 전까지가 이 절의 몸통이다.
    while (details.nextElementSibling && !HEADING.has(details.nextElementSibling.tagName)) {
      details.append(details.nextElementSibling)
    }
    // 몸통이 없으면 접을 것도 없다 — 원래 제목으로 되돌린다.
    if (details.children.length === 1) details.replaceWith(h)
  }

  return host.innerHTML
}
