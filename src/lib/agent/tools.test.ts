import { describe, it, expect } from 'vitest'
import { budgetContent, READ_BUDGET } from './tools'

describe('budgetContent', () => {
  it('예산 안이면 그대로', () => {
    expect(budgetContent('짧음')).toEqual({ text: '짧음', truncated: false })
  })

  it('예산을 넘으면 자르고 잘렸다고 알린다', () => {
    const long = 'a'.repeat(READ_BUDGET + 100)
    const r = budgetContent(long)
    expect(r.truncated).toBe(true)
    expect(r.text.length).toBeLessThanOrEqual(READ_BUDGET + 64)
    expect(r.text).toContain('잘렸습니다')
  })

  it('정확히 예산 크기면 자르지 않는다', () => {
    expect(budgetContent('a'.repeat(READ_BUDGET)).truncated).toBe(false)
  })
})
