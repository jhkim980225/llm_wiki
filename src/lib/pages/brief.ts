import { createHash } from 'node:crypto'

/**
 * 적재본 문서의 열람 시점 요약.
 *
 * 적재본은 18만 건이다. 미리 다 만들면 토큰이 감당이 안 되고, 대부분은 아무도 안 연다.
 * 그래서 **사람이 그 문서를 열었을 때만** 만들고 캐시한다(brief). 본문이 바뀌면
 * briefHash가 어긋나 다음 열람에서 다시 만든다.
 *
 * 이 모듈은 I/O가 없다 — 무엇을 보낼지·다시 만들지만 정한다. LLM 호출과 저장은 Route Handler.
 */

/** LLM에 보낼 본문 상한. 메일 본문 리터럴이 수십 KB짜리가 있어 자른다. */
export const MAX_INPUT = 3000

export const briefHash = (content: string) =>
  createHash('sha256').update(content).digest('hex').slice(0, 32)

/** 요약을 새로 만들어야 하나. 없거나, 만든 뒤 본문이 바뀌었으면 만든다. */
export function needsBrief(
  page: { content: string; brief: string | null; briefHash: string | null },
): boolean {
  if (!page.brief) return true
  return page.briefHash !== briefHash(page.content)
}

/**
 * 본문에서 요약에 쓸 부분만 남긴다.
 * - 관계 절의 `[[slug|표시명]]`은 표시명만 남긴다 — slug는 토큰만 먹고 뜻이 없다
 * - 마크다운 표 구분줄·클래스명 백틱 줄은 버린다
 * - 상한까지 자른다
 */
export function briefInput(title: string, content: string): string {
  const body = content
    .split(/\r?\n/)
    .filter((ln) => !/^\|[\s:|-]+\|$/.test(ln))
    .map((ln) => ln.replace(/\[\[[^\]|]*\|([^\]]+)\]\]/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return `제목: ${title}\n\n${body}`.slice(0, MAX_INPUT)
}

export const BRIEF_SYSTEM = [
  '너는 사내 지식베이스의 개체 문서를 읽고 한 문단으로 요약한다.',
  '- 2~4문장. 이 개체가 무엇이고 누구와 어떤 일로 엮여 있는지 적는다.',
  '- 문서에 있는 사실만 쓴다. 없는 것을 지어내지 마라.',
  '- 속성 이름(bodyPreview, sourceSha256 같은 것)이나 관계 이름을 그대로 나열하지 마라. 사람 말로 풀어 쓴다.',
  '- 제목을 그대로 반복하지 마라.',
  '- 마크다운 서식·머리말·따옴표 없이 본문만 출력한다.',
].join('\n')

/** 모델이 붙이곤 하는 군더더기를 걷어낸다. 빈 문자열이면 저장하지 않는다. */
export function cleanBrief(text: string): string {
  return text
    .replace(/^```[a-z]*\n?|```$/g, '')
    .replace(/^(요약|정리)\s*[:：-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600)
}
