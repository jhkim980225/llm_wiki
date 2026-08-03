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

import { computeForbiddenSpans } from './links'

const covers = (s: string, spans: { start: number; end: number }[], needle: string) => {
  const at = s.indexOf(needle)
  return spans.some((sp) => sp.start <= at && at + needle.length <= sp.end)
}

describe('computeForbiddenSpans', () => {
  it('펜스 코드블록 전체를 금지한다', () => {
    const s = '앞\n```\nacme 내부\n```\n뒤'
    expect(covers(s, computeForbiddenSpans(s).spans, 'acme 내부')).toBe(true)
  })

  it('물결 펜스도 금지한다', () => {
    const s = '앞\n~~~\nacme\n~~~\n뒤'
    expect(covers(s, computeForbiddenSpans(s).spans, 'acme')).toBe(true)
  })

  it('인라인 코드를 금지한다', () => {
    const s = '이건 `acme` 코드'
    expect(covers(s, computeForbiddenSpans(s).spans, '`acme`')).toBe(true)
  })

  it('기존 위키링크를 금지하고 slug를 수집한다', () => {
    const s = '[[entity/acme|Acme]] 언급'
    const r = computeForbiddenSpans(s)
    expect(covers(s, r.spans, '[[entity/acme|Acme]]')).toBe(true)
    expect(r.linkedSlugs.has('entity/acme')).toBe(true)
  })

  it('마크다운 링크와 이미지를 금지한다', () => {
    const s = '[Acme](http://a) ![Acme](http://b)'
    const spans = computeForbiddenSpans(s).spans
    expect(covers(s, spans, '[Acme](http://a)')).toBe(true)
    expect(covers(s, spans, '![Acme](http://b)')).toBe(true)
  })

  it('자동링크를 금지한다', () => {
    const s = '<http://acme.com>'
    expect(covers(s, computeForbiddenSpans(s).spans, '<http://acme.com>')).toBe(true)
  })

  it('일반 문장은 금지 구간이 없다', () => {
    expect(computeForbiddenSpans('Acme는 회사다').spans).toEqual([])
  })

  it('한글 앞에 있어도 오프셋이 맞는다', () => {
    const s = '한글한글한글 `acme` 끝'
    expect(covers(s, computeForbiddenSpans(s).spans, '`acme`')).toBe(true)
  })
})
