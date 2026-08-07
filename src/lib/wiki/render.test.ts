import { describe, it, expect } from 'vitest'
import { wikiLinksToHtml } from './render'

describe('wikiLinksToHtml', () => {
  it('[[문서 제목]]처럼 제목으로 쓴 링크를 slug로 정규화해 살아 있는 링크로 만든다', () => {
    const existing = new Set(['주식회사-성진-구성원'])
    const html = wikiLinksToHtml('[[주식회사 성진 구성원]]', existing)
    expect(html).toContain('href="/wiki/%EC%A3%BC%EC%8B%9D%ED%9A%8C%EC%82%AC-%EC%84%B1%EC%A7%84-%EA%B5%AC%EC%84%B1%EC%9B%90"')
    expect(html).not.toContain('dead')
    expect(html).toContain('>주식회사 성진 구성원<')
  })

  const existing = new Set(['e/acme'])

  it('존재하는 페이지는 보통 링크', () => {
    const html = wikiLinksToHtml('[[e/acme|에이크미]]', existing)
    expect(html).toContain('href="/wiki/e/acme"')
    expect(html).toContain('>에이크미<')
    expect(html).not.toContain('dead')
  })

  it('없는 페이지는 dead 클래스', () => {
    const html = wikiLinksToHtml('[[없음]]', existing)
    expect(html).toContain('class="wikilink dead"')
  })

  it('표시명이 없으면 slug를 보여준다', () => {
    expect(wikiLinksToHtml('[[e/acme]]', existing)).toContain('>e/acme<')
  })

  it('표시명의 HTML을 이스케이프한다', () => {
    const html = wikiLinksToHtml('[[e/acme|<img src=x onerror=alert(1)>]]', existing)
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('slug의 따옴표가 속성을 탈출하지 못한다', () => {
    const html = wikiLinksToHtml('[[a" onmouseover="alert(1)]]', existing)
    expect(html).not.toContain('onmouseover="alert(1)"')
  })

  it('링크가 없으면 원문 그대로', () => {
    expect(wikiLinksToHtml('평범한 문장', existing)).toBe('평범한 문장')
  })

  it('그래프 개체 링크에 data-etype을 단다', () => {
    const html = wikiLinksToHtml(
      '[[e/acme|에이크미]]와 [[주식회사 성진 구성원]]',
      existing,
      new Map([['e/acme', 'organization']]),
    )
    expect(html).toContain('data-etype="organization"')
    // 지정 안 된 링크에는 안 붙는다
    expect(html.split('data-etype').length - 1).toBe(1)
  })

  it('타입 값의 속성 탈출을 막는다 — 영숫자만 남긴다', () => {
    const html = wikiLinksToHtml('[[e/acme]]', existing, new Map([['e/acme', '" onmouseover="x']]))
    expect(html).toContain('data-etype="onmouseoverx"')
    expect(html).not.toContain('onmouseover=')
  })
})
