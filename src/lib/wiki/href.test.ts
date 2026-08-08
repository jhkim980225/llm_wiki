import { describe, it, expect } from 'vitest'
import { wikiHref, stripBasePath } from './href'

describe('stripBasePath', () => {
  // 실측: 라우터가 basePath를 또 붙여 /graphwiki/graphwiki/wiki/… 가 됐다
  it('basePath를 벗긴다', () => {
    expect(stripBasePath('/graphwiki/wiki/ejkim/코바상사')).toBe('/wiki/ejkim/코바상사')
  })

  it('루트는 /로', () => {
    expect(stripBasePath('/graphwiki')).toBe('/')
  })

  it('basePath가 없으면 그대로 (본문 위키링크는 안 붙는다)', () => {
    expect(stripBasePath('/wiki/a/b')).toBe('/wiki/a/b')
  })

  it('이름이 겹치는 경로를 잘못 자르지 않는다', () => {
    expect(stripBasePath('/graphwiki-old/wiki/a')).toBe('/graphwiki-old/wiki/a')
  })

  it('wikiHref 결과를 되돌린다', () => {
    const slug = 'ejkim/코바상사'
    expect(stripBasePath(wikiHref(slug))).toBe('/wiki/ejkim/' + encodeURIComponent('코바상사'))
  })
})

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
