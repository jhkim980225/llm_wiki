'use client'
import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

/** 캔버스처럼 CSS를 쓰지 않는 곳이 테마 전환을 알아채는 통로. */
export const THEME_EVENT = 'wikigraph:theme'

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark')

  // 첫 페인트에서 테마를 입히는 건 layout의 인라인 스크립트다.
  // 여기서는 이미 정해진 값을 읽어와 버튼 표시만 맞춘다.
  useEffect(() => {
    const current = document.documentElement.dataset.theme
    setTheme(current === 'light' ? 'light' : 'dark')
  }, [])

  const flip = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    localStorage.setItem('theme', next)
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: next }))
  }

  return (
    <button
      className="ghost"
      onClick={flip}
      aria-label={theme === 'dark' ? '밝은 테마로' : '어두운 테마로'}
      title={theme === 'dark' ? '밝은 테마로' : '어두운 테마로'}
      style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', letterSpacing: '0.12em' }}
    >
      {theme === 'dark' ? '☾ DARK' : '☀ LIGHT'}
    </button>
  )
}
