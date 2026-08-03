import { describe, it, expect } from 'vitest'
import { normalizeLabel, matchLayers } from './match'

describe('normalizeLabel', () => {
  it('트림·소문자·공백단일화', () => {
    expect(normalizeLabel('  Acme   Corp ')).toBe('acme corp')
  })
})

describe('matchLayers', () => {
  const pages = [
    { slug: 'e/acme', title: 'Acme Corp', aliases: ['에이크미'] },
    { slug: 'e/beta', title: 'Beta', aliases: [] },
  ]

  it('title 완전일치를 잇는다', () => {
    expect(matchLayers(pages, [{ uri: 'urn:1', label: 'acme corp' }])).toEqual([
      { pageSlug: 'e/acme', entityUri: 'urn:1' },
    ])
  })

  it('alias 완전일치도 잇는다', () => {
    expect(matchLayers(pages, [{ uri: 'urn:2', label: ' 에이크미 ' }])).toEqual([
      { pageSlug: 'e/acme', entityUri: 'urn:2' },
    ])
  })

  it('부분일치는 잇지 않는다', () => {
    expect(matchLayers(pages, [{ uri: 'urn:3', label: 'Acme' }])).toEqual([])
  })

  it('매칭되는 개체가 없으면 빈 배열', () => {
    expect(matchLayers(pages, [{ uri: 'urn:4', label: '모르는것' }])).toEqual([])
  })

  it('같은 이름이 여러 페이지에 있으면 먼저 나온 페이지가 이긴다', () => {
    const dup = [
      { slug: 'first', title: '중복', aliases: [] },
      { slug: 'second', title: '중복', aliases: [] },
    ]
    expect(matchLayers(dup, [{ uri: 'urn:5', label: '중복' }])).toEqual([
      { pageSlug: 'first', entityUri: 'urn:5' },
    ])
  })
})
