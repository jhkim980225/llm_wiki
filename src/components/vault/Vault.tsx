'use client'
import { useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  FileText,
  Home,
  MessageSquareText,
  Settings as SettingsIcon,
  Share2,
  Sparkles,
  Import,
  Trash2,
  Waypoints,
} from 'lucide-react'
import { SidebarItem } from '@/components/ui'
import { FileTree } from './FileTree'
import { Settings } from './Settings'

/** 현재 열린 문서의 slug. 경로가 /wiki/a/b 면 "a/b". */
function slugFromPath(pathname: string): string {
  if (!pathname.startsWith('/wiki/')) return ''
  return pathname
    .slice('/wiki/'.length)
    .split('/')
    .map(decodeURIComponent)
    .join('/')
}

const IC = 17 // 메뉴 아이콘 크기 (docs/design.md)

export function Vault({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const activeSlug = slugFromPath(pathname)

  const [collapsed, setCollapsed] = useState(false)
  const [settings, setSettings] = useState(false)

  const router = useRouter()

  /**
   * 볼트 어디서든 내부 <a> 클릭을 라우터로 넘긴다 — 트리·레일·검색 결과가 전부
   * 맨 앵커라서, 여기 한 곳이 클라이언트 라우팅(과 라우트 fade)을 보장한다.
   * 새 탭·수정키·외부 주소·이미 처리된 이벤트는 브라우저에 맡긴다.
   */
  const intercept = (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    const a = (e.target as HTMLElement).closest('a')
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return
    const href = a.getAttribute('href') ?? ''
    if (!href.startsWith('/')) return
    e.preventDefault()
    router.push(href)
  }

  // 로그인 화면은 셸(레일·트리) 밖에서 전체 화면으로 그린다. (훅 호출 뒤에 분기해야 안전)
  if (pathname === '/login') return <>{children}</>

  return (
    <div className={`vault${collapsed ? ' collapsed' : ''}`} onClick={intercept}>
      <nav className="rail" aria-label="글로벌 내비게이션">
        <a className="logo" href="/" aria-label="주식회사 성진 홈">
          <Share2 size={18} aria-hidden />
          <span>주식회사 성진</span>
        </a>

        <SidebarItem icon={<Home size={IC} aria-hidden />} label="홈" href="/" on={pathname === '/'} />
        {/* 트리 접기/펼치기 토글 — 위치 표시가 아니라서 on을 주지 않는다 (과다 강조 금지) */}
        <SidebarItem
          icon={<FileText size={IC} aria-hidden />}
          label="문서"
          onClick={() => setCollapsed((c) => !c)}
        />
        <SidebarItem
          icon={<Waypoints size={IC} aria-hidden />}
          label="그래프"
          href="/graph"
          on={pathname === '/graph'}
        />
        <SidebarItem icon={<Sparkles size={IC} aria-hidden />} label="AI 작성" href="/ask" on={pathname === '/ask'} />
        <SidebarItem
          icon={<MessageSquareText size={IC} aria-hidden />}
          label="도우미"
          href="/chat"
          on={pathname === '/chat'}
        />
        <SidebarItem icon={<Import size={IC} aria-hidden />} label="소스" href="/sources" on={pathname === '/sources'} />
        <SidebarItem icon={<Trash2 size={IC} aria-hidden />} label="휴지통" href="/trash" on={pathname === '/trash'} />

        <span className="grow" />

        <div className="rail-sep" role="separator" />
        <SidebarItem
          icon={<SettingsIcon size={IC} aria-hidden />}
          label="설정"
          on={settings}
          onClick={() => setSettings(true)}
        />
      </nav>

      {settings && <Settings onClose={() => setSettings(false)} />}

      <aside className="sidebar">
        <FileTree activeSlug={activeSlug} />
      </aside>

      <section className="main">{children}</section>
    </div>
  )
}
