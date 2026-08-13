import { describe, expect, it } from 'vitest'
import { MAX_INPUT, briefHash, briefInput, cleanBrief, needsBrief } from './brief'

describe('needsBrief', () => {
  const content = '## 속성\n\n| 항목 | 값 |\n|---|---|\n| a | b |\n'

  it('요약이 없으면 만든다', () => {
    expect(needsBrief({ content, brief: null, briefHash: null })).toBe(true)
  })

  it('요약이 있고 본문이 그대로면 다시 만들지 않는다', () => {
    expect(needsBrief({ content, brief: '요약', briefHash: briefHash(content) })).toBe(false)
  })

  it('본문이 바뀌면 다시 만든다 — 재적재로 갱신된 경우', () => {
    expect(needsBrief({ content: content + '변경', brief: '요약', briefHash: briefHash(content) })).toBe(true)
  })
})

describe('briefInput', () => {
  it('위키링크는 표시명만 남긴다 — slug는 토큰만 먹는다', () => {
    const out = briefInput('발주서 송부', '- [[ejkim/멜라토닝앰플-발주서|멜라토닝앰플 발주서]]와 연결')
    expect(out).toContain('멜라토닝앰플 발주서')
    expect(out).not.toContain('ejkim/')
    expect(out).not.toContain('[[')
  })

  it('표 구분줄은 버린다', () => {
    expect(briefInput('t', '| 항목 | 값 |\n|---|---|\n| a | b |')).not.toContain('|---|')
  })

  it('상한까지 자른다 — 메일 본문이 수십 KB짜리가 있다', () => {
    expect(briefInput('t', '가'.repeat(50_000))).toHaveLength(MAX_INPUT)
  })

  it('제목을 앞에 붙인다', () => {
    expect(briefInput('발주서 송부', '본문')).toMatch(/^제목: 발주서 송부/)
  })
})

describe('cleanBrief', () => {
  it('코드펜스와 머리말을 걷어낸다', () => {
    expect(cleanBrief('```\n요약: 이 문서는 발주서다.\n```')).toBe('이 문서는 발주서다.')
  })

  it('줄바꿈을 공백으로 눕히고 길이를 자른다', () => {
    expect(cleanBrief('가\n\n나')).toBe('가 나')
    expect(cleanBrief('가'.repeat(1000))).toHaveLength(600)
  })

  it('빈 응답은 빈 문자열 — 호출부가 저장하지 않는다', () => {
    expect(cleanBrief('   \n  ')).toBe('')
  })
})
