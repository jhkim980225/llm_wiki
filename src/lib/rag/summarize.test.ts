import { describe, it, expect } from 'vitest'
import { summarize } from './compose'

describe('summarize', () => {
  // 실측 사고: 마크다운 기호를 먼저 지우면 [[slug|라벨]]이 slug라벨로 붙어 버렸다
  it('표시명 있는 위키링크는 표시명만 남긴다', () => {
    expect(summarize('[[ejkim/코바상사|코바상사]]는 거래처다')).toBe('코바상사는 거래처다')
  })

  it('표시명 없는 링크는 마지막 조각만 남긴다', () => {
    expect(summarize('[[ejkim/정아라]] 연구원')).toBe('정아라 연구원')
  })

  it('마크다운 기호를 걷어낸다', () => {
    expect(summarize('**중요** _강조_ `코드`')).toBe('중요 강조 코드')
  })

  it('상한을 넘으면 자르고 말줄임표', () => {
    const r = summarize('가'.repeat(200))
    expect(r).toHaveLength(121)
    expect(r.endsWith('…')).toBe(true)
  })

  // 자르는 위치에 여는 대괄호가 걸리면 "[[ejkim/화장품제조" 같은 꼬리가 남는다
  it('잘린 끝에 남은 여는 대괄호를 걷어낸다', () => {
    const body = '앞부분 '.repeat(20) + '[[ejkim/화장품제조|화장품 제조]] 뒤'
    const r = summarize(body)
    expect(r).not.toContain('[')
  })

  it('빈 줄은 빈 문자열', () => {
    expect(summarize('')).toBe('')
  })
})
