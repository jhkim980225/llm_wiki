import { describe, expect, it } from 'vitest'
import { summarizeEntity } from './entity-summary'

const DOC = `\`EmailMessage\` · \`Email\`

## 속성

| 항목 | 값 |
|---|---|
| subject | SJ LAB 선크림W 용역보고서 초안 송부 |

## 관계

### authoredBy

- [[ejkim/유일한|유일한]]

### hasBusinessFact

- [[ejkim/30-ml-용량|30 mL · 용량]]
- [[ejkim/2026-06-29-업무-일정|2026-06-29 · 업무 일정]]
- [[ejkim/제조-lot-260612a|제조 LOT 260612A]]

### mentionsItem

- [[ejkim/정제수|정제수]]
- [[ejkim/징크옥사이드|징크옥사이드]]
- [[ejkim/티타늄다이옥사이드|티타늄다이옥사이드]]
- [[ejkim/글리세린|글리세린]]
- [[ejkim/부틸렌글라이콜|부틸렌글라이콜]]

## 이 문서를 가리키는 관계

### evidenceEmail

- [[ejkim/ph|ph]]
- [[ejkim/1-68|1.68]]
- [[ejkim/02-2092-3721|02-2092-3721]]
- [[ejkim/뷰티소비재센터|뷰티소비재센터]]
`

describe('summarizeEntity', () => {
  it('값 노드는 뺀다 — 수치·전화번호·날짜', () => {
    const rels = summarizeEntity(DOC)
    const labels = rels.flatMap((g) => g.links.map((l) => l.label))
    expect(labels).toContain('유일한')
    expect(labels).toContain('정제수')
    expect(labels).not.toContain('30 mL · 용량')
    expect(labels).not.toContain('02-2092-3721')
    expect(labels).not.toContain('1.68')
  })

  it('값만 남는 관계는 통째로 사라진다', () => {
    expect(summarizeEntity(DOC).map((g) => g.rel)).not.toContain('hasBusinessFact')
  })

  it('관계당 4개까지만 보여 주고 나머지는 수로 센다', () => {
    const g = summarizeEntity(DOC).find((x) => x.rel === 'mentionsItem')!
    expect(g.links).toHaveLength(4)
    expect(g.total).toBe(5)
  })

  it('나가는 관계가 들어오는 관계보다 앞에 온다', () => {
    const dirs = summarizeEntity(DOC).map((g) => g.dir)
    expect(dirs.indexOf('out')).toBeLessThan(dirs.indexOf('in'))
  })

  it('중요한 관계(authoredBy)가 부수적인 것보다 위', () => {
    const rels = summarizeEntity(DOC).map((g) => g.rel)
    expect(rels.indexOf('authoredBy')).toBeLessThan(rels.indexOf('mentionsItem'))
  })

  // kakao는 업무일지 한 줄을 통째로 개체로 만든다 — 카드에 오면 요약이 아니라 덤프가 된다.
  it('문장 덤프 라벨은 빼되 긴 메일 제목은 남긴다', () => {
    const md = `## 관계

### 명시수량

- [[kakao/a|2025-06-30 18:28 김윤서: 6/30(월) 업무일지 보내드립니다. 1. 엘랑드벨라 - 108ea*3box, 78ea*1box 태그까지 부착 완료하여 내일 출고만 하면 됨 2]]
- [[kakao/b|2025-06-16 19:42 김윤서: 6월 16일(월) 업무일지 보냅니다. 1. 인수인계 - 원료 발주, 샘플라벨 출력 등 교육받음 2. 향료 - 향료 샘플 리스트 작성 3. 집기]]

### belongsToCase

- [[ejkim/c|[럽앤다이브] 아로마 롤온 10ml 단상자, 라벨 문안 검수 요청의 건]]
`
    const rels = summarizeEntity(md)
    expect(rels.map((g) => g.rel)).not.toContain('명시수량')
    expect(rels.find((g) => g.rel === 'belongsToCase')?.links).toHaveLength(1)
  })

  it('개체 문서가 아니면(관계 절 없음) 빈 배열', () => {
    expect(summarizeEntity('# 그냥 문서\n\n본문입니다.\n')).toEqual([])
  })

  it('속성 표의 파이프는 링크로 오인하지 않는다', () => {
    expect(summarizeEntity('## 속성\n\n| 항목 | 값 |\n|---|---|\n| a | b |\n')).toEqual([])
  })
})
