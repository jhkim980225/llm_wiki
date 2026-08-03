import { describe, it, expect } from 'vitest'
import { parseOutLinks } from './links'

describe('parseOutLinks', () => {
  it('[[slug]] 형태를 뽑는다', () => {
    expect(parseOutLinks('앞 [[entity/acme]] 뒤')).toEqual(['entity/acme'])
  })

  it('[[slug|표시명]]에서 slug만 뽑는다', () => {
    expect(parseOutLinks('[[concept/rag|검색증강생성]]')).toEqual(['concept/rag'])
  })

  it('중복을 한 번만 반환한다', () => {
    expect(parseOutLinks('[[a]] [[a]] [[a|A]]')).toEqual(['a'])
  })

  it('빈 링크와 공백만 있는 링크는 무시한다', () => {
    expect(parseOutLinks('[[]] [[   ]] [[b]]')).toEqual(['b'])
  })

  it('한글 slug를 그대로 뽑는다', () => {
    expect(parseOutLinks('[[개체/마데카소사이드로션]]')).toEqual(['개체/마데카소사이드로션'])
  })

  it('링크가 없으면 빈 배열', () => {
    expect(parseOutLinks('평범한 문장')).toEqual([])
  })
})
