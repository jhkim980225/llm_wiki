import type { ReactNode } from 'react'
import { IBM_Plex_Sans_KR, IBM_Plex_Mono, Gowun_Batang } from 'next/font/google'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import './globals.css'

const body = IBM_Plex_Sans_KR({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-plex-kr',
  display: 'swap',
})

const display = Gowun_Batang({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-gowun',
  display: 'swap',
})

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
})

export const metadata = {
  title: 'Wiki Graph',
  description: '위키와 지식 그래프',
}

/**
 * 첫 페인트 전에 테마를 확정한다. React에 맡기면 라이트로 저장한 사용자가
 * 한 프레임 동안 다크를 보게 된다. 저장값이 없으면 다크가 기본이다.
 */
const NO_FLASH = `(function(){try{var t=localStorage.getItem('theme');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}})()`

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="ko"
      data-theme="dark"
      className={`${body.variable} ${display.variable} ${mono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body>
        <div className="aurora" />
        <div className="grain" />

        <header className="topbar">
          <a href="/" className="brand">
            Wiki<span style={{ color: 'var(--accent)' }}>·</span>Graph
          </a>
          <nav>
            <a href="/wiki">위키</a>
            <a href="/graph">연결 보기</a>
            <a href="/sources">소스</a>
            <a href="/chat">도우미</a>
          </nav>
          <span className="spacer" />
          <ThemeToggle />
        </header>

        {children}
      </body>
    </html>
  )
}
