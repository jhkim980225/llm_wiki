import { describe, it, expect } from 'vitest'
import { wikiLinksToHtml } from './render'

describe('wikiLinksToHtml', () => {
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
})
