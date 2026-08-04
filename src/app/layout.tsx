import type { ReactNode } from 'react'
import { IBM_Plex_Sans_KR, IBM_Plex_Mono } from 'next/font/google'
import { Vault } from '@/components/vault/Vault'
import './globals.css'

const body = IBM_Plex_Sans_KR({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-plex-kr',
  display: 'swap',
})

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
})

export const metadata = { title: 'Wiki', description: '사내 위키' }

/** 첫 페인트 전에 테마를 확정한다. 기본은 다크. */
const NO_FLASH = `(function(){try{var t=localStorage.getItem('theme');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}})()`

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" data-theme="dark" className={`${body.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body>
        <Vault>{children}</Vault>
      </body>
    </html>
  )
}
