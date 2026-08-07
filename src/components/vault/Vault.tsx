'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  CalendarDays,
  ChevronsRight,
  Home,
  Menu,
  MessageSquare,
  Settings as SettingsIcon,
  Share2,
  Sparkles,
  Trash2,
  Waypoints,
  Workflow,
} from 'lucide-react'
import { SidebarItem } from '@/components/ui'
import { FileTree } from './FileTree'
import { Settings } from './Settings'
import { version } from '../../../package.json'

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

  // 접힘 상태는 localStorage에 기억한다. SSR과의 hydration 불일치를 피해 effect에서 읽는다.
  // 모바일(≤1023px)에선 트리가 콘텐츠 위 오버레이라 기본 접힘으로 둔다 — 안 그러면
  // 페이지를 열 때마다 트리가 화면을 덮는다. 데스크톱 저장값과 무관하게 접고 시작한다.
  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 1023px)').matches
    setCollapsed(narrow ? true : localStorage.getItem('sidebar-collapsed') === '1')
  }, [])
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem('sidebar-collapsed', c ? '0' : '1')
      return !c
    })
  }

  // 홈 가이드 등 셸 밖 컴포넌트가 설정 모달을 열 수 있게 이벤트를 받는다
  useEffect(() => {
    const open = () => setSettings(true)
    window.addEventListener('wiki:open-settings', open)
    return () => window.removeEventListener('wiki:open-settings', open)
  }, [])

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
        <div className="rail-head">
          <a className="logo" href="/" aria-label="주식회사 성진 홈">
            <Share2 size={18} aria-hidden />
            <span>주식회사 성진</span>
          </a>
          {/* 옵시디언식 접기 — 접으면 아이콘만 남고 문서 트리도 숨는다. >>로 복귀 */}
          <button
            className="rail-toggle"
            aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
            title={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
            onClick={toggleCollapsed}
          >
            {collapsed ? <ChevronsRight size={16} /> : <Menu size={16} />}
          </button>
        </div>

        <SidebarItem icon={<Home size={IC} aria-hidden />} label="홈" href="/" on={pathname === '/'} />
        <SidebarItem
          icon={<Waypoints size={IC} aria-hidden />}
          label="그래프"
          href="/graph"
          on={pathname === '/graph'}
        />
        <SidebarItem icon={<Sparkles size={IC} aria-hidden />} label="AI 작성" href="/ask" on={pathname === '/ask'} />
        <SidebarItem icon={<MessageSquare size={IC} aria-hidden />} label="채팅" href="/chat" on={pathname === '/chat'} />
        {/* WBS 일정은 고정 메뉴에서 뺐다 — 템플릿 폴더의 양식 문서 + FLOW로 다룬다 (/wbs URL은 유지) */}
        <SidebarItem icon={<Workflow size={IC} aria-hidden />} label="FLOW" href="/flow" on={pathname === '/flow'} />
        <SidebarItem icon={<CalendarDays size={IC} aria-hidden />} label="캘린더" href="/calendar" on={pathname === '/calendar'} />
        <SidebarItem icon={<Trash2 size={IC} aria-hidden />} label="휴지통" href="/trash" on={pathname === '/trash'} />

        <span className="grow" />

        <div className="rail-sep" role="separator" />
        <SidebarItem
          icon={<SettingsIcon size={IC} aria-hidden />}
          label="설정"
          on={settings}
          onClick={() => setSettings(true)}
        />
        <span className="rail-version" title={`버전 v${version}`}>
          v{version}
        </span>
      </nav>

      {settings && <Settings onClose={() => setSettings(false)} />}

      <aside className="sidebar">
        <FileTree activeSlug={activeSlug} />
      </aside>

      <section className="main">{children}</section>
    </div>
  )
}
