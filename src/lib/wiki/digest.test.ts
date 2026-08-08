import { describe, it, expect } from 'vitest'
import { digest } from './digest'

const doc = `\`Organization\`

## 속성

| 항목 | 값 |
|---|---|
| dominantRole | 고객사 |
| entityKind | organization |

## 관계

### hasCustomer

- [[ejkim/주성진|(주)성진]]
`

describe('digest', () => {
  it('속성 표를 뽑는다', () => {
    expect(digest(doc).rows).toEqual([
      ['dominantRole', '고객사'],
      ['entityKind', 'organization'],
    ])
  })

  it('관계 절의 표는 섞이지 않는다', () => {
    const r = digest(doc)
    expect(r.rows.every(([k]) => k !== 'hasCustomer')).toBe(true)
  })

  // 실측: ejkim/연구원은 같은 키(context)가 30행 — 표가 그것만으로 찬다
  it('같은 항목이 반복되면 첫 건만 남기고 센다', () => {
    const many = ['`Person`', '', '## 속성', '', '| 항목 | 값 |', '|---|---|']
      .concat(Array.from({ length: 12 }, (_, i) => `| context | 발췌 ${i} |`))
      .join('\n')
    const r = digest(many)
    expect(r.rows).toEqual([['context', '발췌 0']])
    expect(r.folded).toBe(11)
  })

  it('속성이 없으면 발췌로 떨어진다', () => {
    const r = digest('`Product`\n\n## 관계\n\n- [[a/b|이름]]과 연결\n')
    expect(r.rows).toEqual([])
    expect(r.excerpt).toContain('이름')
    expect(r.excerpt).not.toContain('[[')
  })

  it('발췌는 400자까지', () => {
    expect(digest('가'.repeat(5000)).excerpt).toHaveLength(400)
  })

  it('긴 값은 200자에서 자른다', () => {
    const long = `## 속성\n| 항목 | 값 |\n|---|---|\n| note | ${'가'.repeat(500)} |`
    expect(digest(long).rows[0][1]).toHaveLength(200)
  })

  it('빈 본문은 빈 결과', () => {
    expect(digest('')).toEqual({ rows: [], excerpt: '', folded: 0 })
  })
})
