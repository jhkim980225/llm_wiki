import { describe, it, expect } from 'vitest'
import { fillTotal } from './fill'

const task = (startDate: string | null, endDate: string | null) => ({
  id: 'x',
  title: 't',
  assignee: null,
  startDate,
  endDate,
})

describe('fillTotal', () => {
  it('태스크별 날짜 수를 합산한다', () => {
    // 3일 + 2일 = 5
    expect(fillTotal([task('2026-04-15', '2026-04-17'), task('2026-04-15', '2026-04-16')])).toBe(5)
  })
  it('날짜 없는 태스크는 0으로 친다', () => {
    expect(fillTotal([task(null, null), task('2026-04-15', '2026-04-15')])).toBe(1)
  })
  it('빈 목록은 0', () => {
    expect(fillTotal([])).toBe(0)
  })
})
