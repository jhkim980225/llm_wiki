import { describe, expect, it } from 'vitest'
import { wbsBlocksToHtml, wbsGridToHtml } from './wbs-grid'

const TABLE = `| WBS | 업무내용 | 담당자 | 시작일 | 종료일 | 기간(일) | 진행 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 생산 | | | | | |
| 1.1 | 원료 입고 | 정아라 | 2026-08-03 | 2026-08-05 | 3 | 100% |
| 1.2 | 샘플 제작 | 최담선 | 2026-08-04 | 2026-08-07 | 4 | 40% |`

describe('wbsGridToHtml', () => {
  it('작업 행마다 시작~종료 날짜 칸만 채운다', () => {
    const html = wbsGridToHtml(TABLE)
    const rows = html.split('<tr').filter((r) => r.includes('원료 입고'))
    expect(rows).toHaveLength(1)
    // 월~수 3칸이 켜지고 목·금은 꺼진다 (8/3 월 ~ 8/7 금)
    expect((rows[0].match(/c-cell on/g) ?? [])).toHaveLength(3)
  })

  it('주말은 열에서 뺀다 — 8/3~8/7이면 5칸', () => {
    expect((wbsGridToHtml(TABLE).match(/c-day"/g) ?? []).length).toBe(5)
  })

  // 레퍼런스(WBS 간트)의 Phase → Week → M T W R F 3단 헤더와 같은 구성.
  it('헤더는 달·주차·요일 3단이다', () => {
    const html = wbsGridToHtml(TABLE)
    expect(html).toContain('c-month')
    expect(html).toContain('2026년 8월')
    expect(html).toContain('1주차 · 8/3')
    expect(html).toContain('rowspan="3"')
  })

  it('날짜 열이 없으면 헤더는 한 단으로 낸다', () => {
    const md = `| WBS | 업무내용 | 담당자 | 시작일 |
| --- | --- | --- | --- |
| 1.1 | 업무 내용 | 담당자 | YYYY-MM-DD |`
    const html = wbsGridToHtml(md)
    expect(html).toContain('rowspan="1"')
    expect(html).not.toContain('c-month')
  })

  it('대분류 행은 날짜가 없고 코드에 점이 없다 — grp로 그린다', () => {
    expect(wbsGridToHtml(TABLE)).toContain('class="grp g1"')
  })

  it('종료일이 비면 기간(영업일)으로 채운다 — 주말을 건너뛴다', () => {
    const md = `| WBS | 업무 | 시작일 | 기간 |
| - | - | - | - |
| 1.1 | 출고 | 2026-08-06 | 3 |`
    // 목요일 시작 + 3영업일 = 목·금·월 → 8/10
    expect(wbsGridToHtml(md)).toContain('2026-08-10')
  })

  it('진행률은 구간 클래스로 — 인라인 style을 쓰지 않는다', () => {
    const html = wbsGridToHtml(TABLE)
    expect(html).toContain('pct done')
    expect(html).toContain('pct low')
    expect(html).not.toContain('style=')
  })

  it('업무명의 [[링크]]는 손대지 않는다 — 뒤 단계가 앵커로 바꾼다', () => {
    const md = `| WBS | 업무 | 시작일 | 종료일 |
| - | - | - | - |
| 1.1 | [[정아라]] 원료 확인 | 2026-08-03 | 2026-08-03 |`
    expect(wbsGridToHtml(md)).toContain('[[정아라]]')
  })

  it('표가 없으면 빈 문자열', () => {
    expect(wbsGridToHtml('그냥 텍스트')).toBe('')
  })

  // 양식 문서가 자리표시자를 그대로 둔다. 예전엔 Invalid Date가 toISOString에서 터졌다.
  it('YYYY-MM-DD 같은 자리표시자는 날짜 열 없이 표로만 그린다', () => {
    const md = `| WBS | 업무내용 | 담당자 | 시작일 | 종료일 | 기간(일) |
| --- | --- | --- | --- | --- | --- |
| 1 | 대분류 A | | | | |
| 1.1 | 업무 내용 | 담당자 | YYYY-MM-DD | YYYY-MM-DD | N |`
    const html = wbsGridToHtml(md)
    expect(html).toContain('업무 내용')
    expect(html).not.toContain('c-day')
    expect(html).not.toContain('c-cell on')
  })

  it('wbs 펜스만 바꾸고 다른 펜스는 둔다', () => {
    const md = '```wbs\n' + TABLE + '\n```\n\n```js\nconst a = 1\n```'
    const out = wbsBlocksToHtml(md)
    expect(out).toContain('wbs-grid')
    expect(out).toContain('```js')
  })
})
