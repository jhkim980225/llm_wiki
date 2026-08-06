// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { Toaster } from './Toaster'
import { toast } from '@/lib/toast'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Toaster', () => {
  it('toast() 발행 → 표시 → 수명이 지나면 사라진다', () => {
    vi.useFakeTimers()
    render(<Toaster />)

    act(() => toast('저장했습니다', 'success'))
    expect(screen.getByText('저장했습니다')).toBeTruthy()

    act(() => vi.advanceTimersByTime(4000))
    expect(screen.queryByText('저장했습니다')).toBeNull()
  })

  it('유형별 클래스가 붙는다', () => {
    render(<Toaster />)
    act(() => toast('실패', 'error'))
    expect(screen.getByText('실패').className).toContain('error')
  })

  it('최대 3개까지만 쌓인다', () => {
    render(<Toaster />)
    act(() => {
      toast('1')
      toast('2')
      toast('3')
      toast('4')
    })
    expect(screen.queryByText('1')).toBeNull()
    expect(screen.getByText('4')).toBeTruthy()
  })
})
