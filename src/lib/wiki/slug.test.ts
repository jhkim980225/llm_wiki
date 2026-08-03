import { describe, it, expect } from 'vitest'
import { normalizeSlug } from './slug'

describe('normalizeSlug', () => {
  it('앞뒤 공백과 슬래시를 정리한다', () => {
    expect(normalizeSlug('  /entity/acme/  ')).toBe('entity/acme')
  })

  it('공백을 하이픈으로 바꾸고 소문자로 만든다', () => {
    expect(normalizeSlug('Entity/Acme Corp')).toBe('entity/acme-corp')
  })

  it('연속 슬래시를 하나로 접는다', () => {
    expect(normalizeSlug('a//b///c')).toBe('a/b/c')
  })

  it('한글은 그대로 둔다', () => {
    expect(normalizeSlug('개체/마데카소사이드 로션')).toBe('개체/마데카소사이드-로션')
  })

  it('경로 탈출 조각을 제거한다', () => {
    expect(normalizeSlug('../../etc/passwd')).toBe('etc/passwd')
  })

  it('위험한 문자를 버린다', () => {
    expect(normalizeSlug('a<b>c?d')).toBe('abcd')
  })

  it('빈 입력은 빈 문자열', () => {
    expect(normalizeSlug('   ')).toBe('')
  })
})
