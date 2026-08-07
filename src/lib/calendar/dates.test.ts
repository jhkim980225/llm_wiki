import { describe, it, expect } from 'vitest'
import { stripLinks, extractDateRange, overlaps, expandDays } from './dates'

describe('stripLinks', () => {
  it('표시명 있는 링크는 표시명으로, 없는 링크는 slug로 편다', () => {
    expect(stripLinks('[[kakao/2026년|2026년]]-08-14 와 [[ejkim/박지혜]]')).toBe(
      '2026년-08-14 와 ejkim/박지혜',
    )
  })
})

describe('extractDateRange', () => {
  it('기간(~)을 뽑는다', () => {
    expect(extractDateRange('# 주간 업무내역 (2026-06-22 ~ 2026-06-28)')).toEqual({
      start: '2026-06-22',
      end: '2026-06-28',
    })
  })

  // 프로덕션 휴가신청서 실측 — linkify가 연도를 링크로 걸어 "2026년-08-14"가 된다.
  it('링크로 쪼개진 "년" 표기도 잡는다', () => {
    const body = '| 기간 | [[kakao/2026년|2026년]]-08-14 ~ [[kakao/2026년|2026년]]-08-14 (총 1일) |'
    expect(extractDateRange(body)).toEqual({ start: '2026-08-14', end: '2026-08-14' })
  })

  it('단일 날짜는 하루짜리 기간이 된다', () => {
    expect(extractDateRange('작성일: 2026-08-07')).toEqual({
      start: '2026-08-07',
      end: '2026-08-07',
    })
  })

  it('가까이 있지만 범위 구분자가 없으면 첫 날짜만 쓴다', () => {
    expect(extractDateRange('2026-08-05 결제, 2026-08-14 입고')).toEqual({
      start: '2026-08-05',
      end: '2026-08-05',
    })
  })

  it('날짜가 없으면 null', () => {
    expect(extractDateRange('날짜 없는 문서')).toBeNull()
  })

  it('뒤집힌 범위는 정렬한다', () => {
    expect(extractDateRange('2026-08-20 ~ 2026-08-18')).toEqual({
      start: '2026-08-18',
      end: '2026-08-20',
    })
  })
})

describe('overlaps', () => {
  const r = { start: '2026-08-10', end: '2026-08-14' }
  it('겹침 판정', () => {
    expect(overlaps(r, '2026-08-01', '2026-08-31')).toBe(true)
    expect(overlaps(r, '2026-08-14', '2026-08-20')).toBe(true)
    expect(overlaps(r, '2026-08-15', '2026-08-20')).toBe(false)
  })
})

describe('expandDays', () => {
  it('기간을 일자로 편다', () => {
    expect(expandDays({ start: '2026-08-30', end: '2026-09-02' })).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ])
  })

  it('상한을 넘지 않는다', () => {
    expect(expandDays({ start: '2026-01-01', end: '2026-12-31' }, 5)).toHaveLength(5)
  })
})
