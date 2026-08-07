import { describe, it, expect } from 'vitest'
import { nextRunAt } from './schedule'

// KST = UTC+9. 2026-08-07은 금요일.
const kst = (s: string) => new Date(new Date(s + '+09:00').getTime())

describe('nextRunAt', () => {
  it('금요일에 계산하면 다음 월요일 9시(KST)', () => {
    const next = nextRunAt(1, 9, kst('2026-08-07T15:00:00'))
    expect(next.toISOString()).toBe('2026-08-10T00:00:00.000Z') // = 8/10(월) 09:00 KST
  })

  it('월요일 9시 이전이면 같은 날', () => {
    const next = nextRunAt(1, 9, kst('2026-08-10T08:00:00'))
    expect(next.toISOString()).toBe('2026-08-10T00:00:00.000Z')
  })

  it('월요일 9시 정각/이후면 다음 주', () => {
    const next = nextRunAt(1, 9, kst('2026-08-10T09:00:00'))
    expect(next.toISOString()).toBe('2026-08-17T00:00:00.000Z')
  })

  it('일요일(0)도 지원', () => {
    const next = nextRunAt(0, 18, kst('2026-08-07T15:00:00'))
    expect(next.toISOString()).toBe('2026-08-09T09:00:00.000Z') // 8/9(일) 18:00 KST
  })
})
