import { describe, it, expect } from 'vitest'
import { wikiHref } from './href'

describe('wikiHref', () => {
  it('basePath를 붙인다 — 새 탭·링크 복사가 깨지면 안 된다', () => {
    expect(wikiHref('ejkim/코바상사')).toBe('/graphwiki/wiki/ejkim/' + encodeURIComponent('코바상사'))
  })

  it('슬래시는 경로 구분자로 남기고 조각만 인코딩한다', () => {
    expect(wikiHref('a/b c')).toBe('/graphwiki/wiki/a/b%20c')
  })

  it('물음표·해시가 든 제목도 주소를 깨지 않는다', () => {
    expect(wikiHref('ejkim/a?b#c')).toBe('/graphwiki/wiki/ejkim/a%3Fb%23c')
  })
})
