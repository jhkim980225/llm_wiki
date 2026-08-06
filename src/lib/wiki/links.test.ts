import { describe, it, expect } from 'vitest'
import { parseOutLinks, sanitizeWikiLinks } from './links'

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

  it('[[문서 제목]]처럼 제목으로 쓴 링크를 slug 규칙으로 정규화한다', () => {
    expect(parseOutLinks('[[주식회사 성진 구성원]] [[Fuseki]]')).toEqual([
      '주식회사-성진-구성원',
      'fuseki',
    ])
  })

  it('표시명에 단일 대괄호가 있어도 링크를 읽는다 (이메일 제목 유래 라벨)', () => {
    expect(parseOutLinks('[[ejkim/성진-a|[성진] 파일 송부의 건]]')).toEqual(['ejkim/성진-a'])
    // 한 줄에 링크 둘 — 서로 잡아먹지 않는다
    expect(parseOutLinks('[[a]] 그리고 [[b|[x] y]]')).toEqual(['a', 'b'])
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

import { linkifyContent, rewriteWikiLinks } from './links'

describe('linkifyContent', () => {
  const refs = [{ slug: 'entity/acme', matchText: 'Acme' }]

  it('첫 출현만 링크로 감싼다', () => {
    const r = linkifyContent('Acme는 회사다. Acme는 크다.', refs, 'self')
    expect(r.content).toBe('[[entity/acme|Acme]]는 회사다. Acme는 크다.')
    expect(r.changed).toBe(true)
  })

  it('코드블록 안은 건드리지 않는다', () => {
    const src = '```\nAcme\n```\nAcme 본문'
    expect(linkifyContent(src, refs, 'self').content).toBe('```\nAcme\n```\n[[entity/acme|Acme]] 본문')
  })

  it('이미 그 slug로 링크돼 있으면 건너뛴다', () => {
    const src = '[[entity/acme|Acme]] 그리고 Acme'
    expect(linkifyContent(src, refs, 'self').changed).toBe(false)
  })

  it('자기 자신은 링크하지 않는다', () => {
    expect(linkifyContent('Acme', refs, 'entity/acme').changed).toBe(false)
  })

  it('ASCII 단어 경계를 지킨다', () => {
    expect(linkifyContent('Acmecorp만 있다', refs, 'self').changed).toBe(false)
  })

  it('CJK는 경계를 따지지 않는다', () => {
    const cjk = [{ slug: '개체/북경', matchText: '북경' }]
    expect(linkifyContent('북경대학교', cjk, 'self').content).toBe('[[개체/북경|북경]]대학교')
  })

  it('긴 matchText를 먼저 매칭한다', () => {
    const two = [
      { slug: 'e/a', matchText: 'Acme' },
      { slug: 'e/ac', matchText: 'Acme Corp' },
    ]
    expect(linkifyContent('Acme Corp 소개', two, 'self').content).toBe('[[e/ac|Acme Corp]] 소개')
  })

  it('주입 후 뒤쪽 금지 구간 오프셋이 밀린다', () => {
    const src = 'Acme 그리고 `Acme` 코드'
    expect(linkifyContent(src, refs, 'self').content).toBe('[[entity/acme|Acme]] 그리고 `Acme` 코드')
  })
})

describe('rewriteWikiLinks', () => {
  it('slug만 바꾸고 표시명은 보존한다', () => {
    expect(rewriteWikiLinks('[[old|이름]]과 [[old]]', 'old', 'new')).toBe('[[new|이름]]과 [[new]]')
  })

  it('다른 slug는 그대로 둔다', () => {
    expect(rewriteWikiLinks('[[other]]', 'old', 'new')).toBe('[[other]]')
  })
})

describe('sanitizeWikiLinks', () => {
  const valid = new Set(['a', 'seunghoon/제품'])

  it('실존 문서 링크는 그대로 둔다', () => {
    expect(sanitizeWikiLinks('본문 [[a]]와 [[seunghoon/제품|제품]]', valid)).toBe(
      '본문 [[a]]와 [[seunghoon/제품|제품]]',
    )
  })

  it('없는 문서 링크는 표시명 평문으로 바꾼다', () => {
    expect(sanitizeWikiLinks('출처: [[seunghoon/없는문서.pdf|MSDS]] (seunghoon)', valid)).toBe(
      '출처: MSDS (seunghoon)',
    )
    expect(sanitizeWikiLinks('[[ghost]]', valid)).toBe('ghost')
  })

  it('제목으로 태깅한 링크는 byTitle로 실제 slug를 찾아 잇는다 (파일명 태깅)', () => {
    const byTitle = new Map([['성진 통장.jpg', 'seunghoon/성진-통장.jpg']])
    expect(sanitizeWikiLinks('첨부: [[성진 통장.jpg]]', valid, byTitle)).toBe(
      '첨부: [[seunghoon/성진-통장.jpg|성진 통장.jpg]]',
    )
    // 표시명 쪽이 제목과 일치해도 찾는다
    expect(sanitizeWikiLinks('[[없는-slug|성진 통장.jpg]]', valid, byTitle)).toBe(
      '[[seunghoon/성진-통장.jpg|성진 통장.jpg]]',
    )
  })

  it('표시명에 대괄호가 든 실존 링크는 살아남는다', () => {
    const v = new Set(['ejkim/성진-a'])
    const input = '[[ejkim/성진-a|[성진] 파일 송부의 건]]'
    expect(sanitizeWikiLinks(input, v)).toBe(input)
  })

  it('짝 잃은 [[ 는 그 줄의 대괄호를 걷어낸다', () => {
    expect(sanitizeWikiLinks('| [[seunghoon/수용성글리세린색소_보라-msds.pdf | 100ml |', valid)).toBe(
      '| seunghoon/수용성글리세린색소_보라-msds.pdf | 100ml |',
    )
  })

  it('여러 줄에서 유효 링크와 잘린 링크를 갈라 처리한다', () => {
    const input = '멀쩡: [[a]]\n잘림: [[seunghoon/뭔가'
    expect(sanitizeWikiLinks(input, valid)).toBe('멀쩡: [[a]]\n잘림: seunghoon/뭔가')
  })
})
