import type { ReactNode } from 'react'
import { JetBrains_Mono } from 'next/font/google'
import { Vault } from '@/components/vault/Vault'
import { Toaster } from '@/components/ui/Toaster'
import './globals.css'

/* 본문 폰트(Pretendard Variable)는 globals.css가 npm 패키지 CSS로 불러온다.
   코드·URI·ID만 JetBrains Mono — 빌드 시 받아 자체 서빙된다. */
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jbmono',
  display: 'swap',
})

export const metadata = { title: '주식회사 성진', description: '사내 위키' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" className={mono.variable}>
      <body>
        <Vault>{children}</Vault>
        <Toaster />
      </body>
    </html>
  )
}
