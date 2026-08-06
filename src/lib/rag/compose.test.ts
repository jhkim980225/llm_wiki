import { describe, it, expect } from 'vitest'
import {
  stripInlineSources,
  splitDoc,
  stripEmailRefs,
  interleaveBySource,
  expandDateTerms,
} from './compose'

describe('expandDateTerms', () => {
  it('한국어 연월 표기에 ISO 변형을 더한다', () => {
    expect(expandDateTerms(['정아라', '2026년 6월'])).toEqual(['정아라', '2026년 6월', '2026-06'])
    expect(expandDateTerms(['2026년 11월'])).toEqual(['2026년 11월', '2026-11'])
  })

  it('날짜가 없으면 그대로', () => {
    expect(expandDateTerms(['황금추출물'])).toEqual(['황금추출물'])
  })
})

describe('interleaveBySource', () => {
  it('한 소스가 앞을 독점해도 소스별로 번갈아 나온다', () => {
    const items = [
      ...['e1', 'e2', 'e3'].map((u) => ({ uri: u, source: 'ejkim' })),
      ...['k1', 'k2'].map((u) => ({ uri: u, source: 'kakao' })),
      { uri: 's1', source: 'seunghoon' },
    ]
    expect(interleaveBySource(items).map((i) => i.uri)).toEqual([
      'e1', 'k1', 's1', 'e2', 'k2', 'e3',
    ])
  })

  it('빈 배열은 빈 배열', () => {
    expect(interleaveBySource([])).toEqual([])
  })
})

describe('stripEmailRefs', () => {
  it('참고 절에서 이메일이 든 항목만 지운다', () => {
    const input = [
      '본문 juhyeok@sungjin.co.kr 은 남는다',
      '',
      '## 참고',
      '- [[a|문서 A]]',
      '- 홍길동 (gildong@corp.com)',
      '- 파일.pdf',
    ].join('\n')
    const out = stripEmailRefs(input)
    expect(out).toContain('juhyeok@sungjin.co.kr') // 본문은 안 건드린다
    expect(out).toContain('문서 A')
    expect(out).toContain('파일.pdf')
    expect(out).not.toContain('gildong')
  })

  it('참고 절이 없으면 그대로 둔다', () => {
    expect(stripEmailRefs('그냥 본문')).toBe('그냥 본문')
  })
})

describe('stripInlineSources', () => {
  it('본문에 박힌 소스 id를 지운다', () => {
    expect(stripInlineSources('글리세롤은 [ejkim] 문서에 나온다')).toBe(
      '글리세롤은 문서에 나온다',
    )
  })

  it('소스 이름도 지운다', () => {
    expect(stripInlineSources('원료 목록 [승훈 온톨로지] 참고')).toBe('원료 목록 참고')
  })

  // 이게 깨지면 참고란 링크가 통째로 망가진다.
  it('[[위키링크]]는 건드리지 않는다', () => {
    const src = '자세히는 [[seunghoon/캐모마일.pdf|캐모마일.pdf]] 를 보라'
    expect(stripInlineSources(src)).toBe(src)
  })

  it('마크다운 링크도 건드리지 않는다', () => {
    const src = '[캐모마일](/wiki/seunghoon/캐모마일.pdf) 문서'
    expect(stripInlineSources(src)).toBe(src)
  })

  it('(출처: …) 꼴도 지운다', () => {
    expect(stripInlineSources('글리세롤 5% (출처: 이메일 온톨로지) 함유')).toBe(
      '글리세롤 5% 함유',
    )
  })

  it('표 칸 안의 출처를 지우고 칸 모양을 지킨다', () => {
    const out = stripInlineSources('| 로즈마리 | 100ml | [ejkim] |')
    expect(out).toBe('| 로즈마리 | 100ml | |')
  })

  it('줄바꿈은 뭉개지 않는다', () => {
    expect(stripInlineSources('첫 줄 [ejkim]\n\n둘째 줄')).toBe('첫 줄\n\n둘째 줄')
  })
})

describe('splitDoc', () => {
  it('첫 제목줄을 제목으로 뽑고 본문에서 뺀다', () => {
    const d = splitDoc('# 글리세롤 정리\n\n첫 문단이다.\n\n## 참고\n- 어쩌고', '대체제목')
    expect(d.title).toBe('글리세롤 정리')
    expect(d.content.startsWith('첫 문단이다.')).toBe(true)
    expect(d.summary).toBe('첫 문단이다.')
  })

  it('제목줄이 없으면 대체 제목을 쓴다', () => {
    expect(splitDoc('제목 없이 시작', '대체제목').title).toBe('대체제목')
  })

  it('나누기 전에 인라인 출처를 걷어낸다', () => {
    const d = splitDoc('# 제목\n\n내용 [ejkim] 이다.', 'x')
    expect(d.content).not.toContain('[ejkim]')
  })
})
