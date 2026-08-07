import { describe, it, expect } from 'vitest'
import { parseWbsMarkdown, tasksToMarkdown, normalizeDate, dateRange } from './markdown'

describe('normalizeDate', () => {
  it('YYYY-MM-DD / YYYY.MM.DD 정규화', () => {
    expect(normalizeDate('2026-04-15')).toBe('2026-04-15')
    expect(normalizeDate('2026.4.5')).toBe('2026-04-05')
  })
  it('MM/DD는 기본 연도 보충', () => {
    expect(normalizeDate('04/15', 2026)).toBe('2026-04-15')
    expect(normalizeDate('4/5', 2026)).toBe('2026-04-05')
  })
  it('빈 값은 null', () => {
    expect(normalizeDate('')).toBeNull()
    expect(normalizeDate(null)).toBeNull()
  })
})

describe('parseWbsMarkdown', () => {
  const md = `앞 문단
| WBS | 업무내용 | 담당자 | 시작일 | 종료일 | 기간(일) |
| --- | --- | --- | --- | --- | --- |
| 1.1 | Mobile-App 테스트 | 태민 | 04/15 | 04/20 | 6 |
| 1.2 | 채널 연동 | 유진 | 2026-04-20 | 2026-04-24 | 5 |`

  it('표를 태스크로 파싱한다(헤더 키워드 매핑)', () => {
    const t = parseWbsMarkdown(md, 2026)
    expect(t).toHaveLength(2)
    expect(t[0]).toEqual({
      wbsCode: '1.1',
      title: 'Mobile-App 테스트',
      assignee: '태민',
      startDate: '2026-04-15',
      endDate: '2026-04-20',
      durationDays: 6,
    })
    expect(t[1].assignee).toBe('유진')
    expect(t[1].startDate).toBe('2026-04-20')
  })

  it('표가 없으면 빈 배열', () => {
    expect(parseWbsMarkdown('그냥 텍스트')).toEqual([])
  })

  it('제목 없는 행은 건너뛴다', () => {
    const t = parseWbsMarkdown(`| WBS | 업무내용 | 담당자 |\n| - | - | - |\n| 1 |  | 태민 |`)
    expect(t).toEqual([])
  })
})

describe('tasksToMarkdown', () => {
  it('왕복(파싱→출력) 후 다시 파싱하면 동등', () => {
    const md = tasksToMarkdown([
      { wbsCode: '1', title: 'A', assignee: '태민', startDate: '2026-04-15', endDate: '2026-04-16', durationDays: 2 },
    ])
    const back = parseWbsMarkdown(md)
    expect(back[0].title).toBe('A')
    expect(back[0].endDate).toBe('2026-04-16')
  })
})

describe('dateRange', () => {
  it('시작~종료 포함 날짜 목록', () => {
    expect(dateRange('2026-04-15', '2026-04-17')).toEqual(['2026-04-15', '2026-04-16', '2026-04-17'])
  })
  it('역전/누락이면 빈 배열', () => {
    expect(dateRange('2026-04-17', '2026-04-15')).toEqual([])
    expect(dateRange(null, '2026-04-15')).toEqual([])
  })
  it('cap으로 폭주 방지', () => {
    expect(dateRange('2026-01-01', '2026-12-31', 10)).toHaveLength(10)
  })
})
