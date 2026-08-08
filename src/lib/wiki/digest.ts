/**
 * 문서 본문에서 속성 표와 발췌를 뽑는다 — LLM 없이 즉시 뜨는 요약.
 * I/O 없는 순수 모듈. 링크 미리보기 팝오버와 개체 그래프 인스펙터가 같이 쓴다.
 */

/** 표에서 가져올 속성 행 수. 패널 높이에 맞춘 값이다. */
const MAX_ROWS = 8

/** 발췌를 만들 때 훑을 본문 앞부분. 적재 개체는 본문이 683KB까지 간다(kakao/정아라 실측) —
 *  전체에 정규식을 돌리면 클릭마다 수 MB를 재할당한다. 400자 발췌엔 앞부분이면 충분하다. */
const SCAN = 4000

export type Digest = {
  /** `## 속성` 표의 [항목, 값] 쌍. 같은 항목이 반복되면 첫 건만 남긴다. */
  rows: [string, string][]
  /** 표가 없을 때 쓸 본문 발췌(마크다운·링크 제거). */
  excerpt: string
  /** 같은 이름의 속성이 접힌 수 — 화면이 "외 N건"으로 알린다. */
  folded: number
}

export function digest(content: string): Digest {
  const rows: [string, string][] = []
  const seen = new Map<string, number>()
  let folded = 0
  let inAttrs = false

  for (const ln of content.split('\n')) {
    if (ln.startsWith('## ')) {
      // 속성 절을 지나쳤으면 더 볼 것이 없다 — 뒤 절은 관계 목록이다.
      if (inAttrs) break
      inAttrs = ln.startsWith('## 속성')
      continue
    }
    if (!inAttrs || !ln.startsWith('|') || ln.includes('---')) continue

    const cells = ln.split('|').map((c) => c.trim()).filter(Boolean)
    if (cells.length < 2 || cells[0] === '항목') continue

    // ejkim의 일부 개체는 같은 키(context 등)가 30행씩 반복된다 — 표가 그것만으로 찬다.
    const n = (seen.get(cells[0]) ?? 0) + 1
    seen.set(cells[0], n)
    if (n > 1) {
      folded++
      continue
    }
    rows.push([cells[0], cells[1].slice(0, 200)])
    if (rows.length >= MAX_ROWS) break
  }

  const excerpt = content
    .slice(0, SCAN)
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, s, d) => d || s)
    .replace(/[#`*_>|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)

  return { rows, excerpt, folded }
}
