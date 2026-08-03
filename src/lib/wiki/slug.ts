/**
 * 사용자·에이전트가 준 slug를 주소로 쓸 수 있는 형태로 정규화한다.
 * slug는 URL 경로에 그대로 들어가므로 경로 탈출(`..`)과 URL 예약문자를 반드시 걷어낸다.
 * 한글은 살린다 — 사내 위키 제목 대부분이 한글이다.
 */
export function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .split('/')
    .map((seg) => seg.trim())
    .filter((seg) => seg !== '' && seg !== '.' && seg !== '..')
    .map((seg) =>
      seg
        .replace(/\s+/g, '-')
        // 남기는 것: 한글·영숫자·하이픈·밑줄·마침표. 나머지는 버린다.
        .replace(/[^\p{Letter}\p{Number}\-_.]/gu, '')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter(Boolean)
    .join('/')
}
