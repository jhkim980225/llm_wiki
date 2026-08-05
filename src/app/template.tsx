'use client'
import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'

/**
 * 라우트 전환마다 fade-in. template은 세그먼트가 바뀔 때만 다시 마운트되고
 * 같은 동적 라우트 안의 param 변경(/wiki/a → /wiki/b)에는 남아 있어서,
 * pathname을 key로 걸어 어떤 전환이든 반드시 새로 마운트되게 한다.
 */
export default function Template({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return (
    <div key={pathname} className="route-fade">
      {children}
    </div>
  )
}
