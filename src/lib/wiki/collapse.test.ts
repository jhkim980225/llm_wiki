// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { collapseSections } from './collapse'

const HTML =
  '<h1>제목</h1><p>본문</p>' +
  '<h2>참고</h2><ul><li><a href="/wiki/a">가</a></li><li><a href="/wiki/b">나</a></li></ul>' +
  '<h2>다음 절</h2><p>뒤 내용</p>'

describe('collapseSections', () => {
  it('참고 절을 details로 감싸고 몸통을 안으로 옮긴다', () => {
    const out = collapseSections(HTML)
    const host = document.createElement('div')
    host.innerHTML = out
    const d = host.querySelector('details')!
    expect(d.querySelector('summary')!.textContent).toBe('참고')
    expect(d.querySelectorAll('a')).toHaveLength(2)
  })

  it('다음 제목부터는 건드리지 않는다', () => {
    const host = document.createElement('div')
    host.innerHTML = collapseSections(HTML)
    expect(host.querySelector('details')!.textContent).not.toContain('뒤 내용')
    expect(host.querySelector('h2')!.textContent).toBe('다음 절')
  })

  it('대상 절이 없으면 그대로 둔다', () => {
    const plain = '<h2>관계</h2><p>내용</p>'
    expect(collapseSections(plain)).toBe(plain)
  })

  it('몸통이 비면 접지 않는다 — 제목만 남긴다', () => {
    const out = collapseSections('<h2>참고</h2><h2>끝</h2>')
    expect(out).not.toContain('<details')
    expect(out).toContain('<h2>참고</h2>')
  })

  it('접을 절 이름을 바꿔 부를 수 있다', () => {
    const out = collapseSections('<h2>출처</h2><p>x</p>', ['출처'])
    expect(out).toContain('<details')
  })

  // 적재본의 역참조 절은 안에 `### 관계이름` 소제목을 둔다 — 거기서 잘리면 안 된다.
  it('절 안의 h3 소제목까지 통째로 접는다', () => {
    const html =
      '<h2>이 문서를 가리키는 관계</h2>' +
      '<h3>문서유형</h3><ul><li><a href="/wiki/a">견적서1.xlsx</a></li></ul>' +
      '<h3>evidenceEmail</h3><ul><li><a href="/wiki/b">메일</a></li></ul>' +
      '<h2>다음 절</h2><p>뒤</p>'
    const host = document.createElement('div')
    host.innerHTML = collapseSections(html)
    const d = host.querySelector('details')!
    expect(d.querySelectorAll('h3')).toHaveLength(2)
    expect(d.querySelectorAll('a')).toHaveLength(2)
    expect(d.textContent).not.toContain('뒤')
  })
})
