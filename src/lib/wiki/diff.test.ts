import { describe, it, expect } from 'vitest'
import { lineDiff } from './diff'

describe('lineDiff', () => {
  it('같은 줄은 same', () => {
    expect(lineDiff('a\nb', 'a\nb')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'same', text: 'b' },
    ])
  })

  it('추가된 줄은 add', () => {
    expect(lineDiff('a', 'a\nb')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'add', text: 'b' },
    ])
  })

  it('삭제된 줄은 del', () => {
    expect(lineDiff('a\nb', 'a')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
    ])
  })

  it('가운데가 바뀌면 del 다음 add', () => {
    expect(lineDiff('a\nx\nc', 'a\ny\nc')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'x' },
      { type: 'add', text: 'y' },
      { type: 'same', text: 'c' },
    ])
  })

  it('빈 문서에서 추가', () => {
    expect(lineDiff('', 'a')).toEqual([
      { type: 'del', text: '' },
      { type: 'add', text: 'a' },
    ])
  })

  it('공통 부분을 최대로 잡는다', () => {
    const r = lineDiff('a\nb\nc\nd', 'a\nc\nd')
    expect(r.filter((l) => l.type === 'same').map((l) => l.text)).toEqual(['a', 'c', 'd'])
    expect(r.filter((l) => l.type === 'del').map((l) => l.text)).toEqual(['b'])
  })
})
