'use client'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { FileTree } from './FileTree'

type Hit = { slug: string; title: string; summary: string }
type Panel = 'files' | 'search'

/** 현재 열린 문서의 slug. 경로가 /wiki/a/b 면 "a/b". */
function slugFromPath(pathname: string): string {
  if (!pathname.startsWith('/wiki/')) return ''
  return pathname
    .slice('/wiki/'.length)
    .split('/')
    .map(decodeURIComponent)
    .join('/')
}

export function Vault({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const activeSlug = slugFromPath(pathname)

  const [panel, setPanel] = useState<Panel>('files')
  const [collapsed, setCollapsed] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [searching, setSearching] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  }, [])

  const flipTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    localStorage.setItem('theme', next)
  }

  const openSearch = useCallback(() => {
    setPanel('search')
    setCollapsed(false)
    setTimeout(() => searchRef.current?.focus(), 0)
  }, [])

  // Ctrl+K로 검색 — 옵시디언과 같은 자리
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openSearch])

  // 검색 입력이 멎으면 질의한다.
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setHits([])
      return
    }
    setSearching(true)
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}&limit=40`)
        .then((r) => r.json())
        .then((b) => setHits(b.items ?? []))
        .finally(() => setSearching(false))
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div className={`vault${collapsed ? ' collapsed' : ''}`}>
      <nav className="rail">
        <button
          className={panel === 'files' && !collapsed ? 'on' : ''}
          title="문서 목록"
          onClick={() => {
            if (panel === 'files') setCollapsed((c) => !c)
            else {
              setPanel('files')
              setCollapsed(false)
            }
          }}
        >
          ▤
        </button>
        <button
          className={panel === 'search' && !collapsed ? 'on' : ''}
          title="검색 (Ctrl+K)"
          onClick={openSearch}
        >
          ⌕
        </button>
        <span className="grow" />
        <a href="/sources" title="온톨로지 소스 가져오기">
          ⇩
        </a>
        <a href="/chat" title="위키 도우미">
          ✎
        </a>
        <button title={theme === 'dark' ? '밝게' : '어둡게'} onClick={flipTheme}>
          {theme === 'dark' ? '☾' : '☀'}
        </button>
      </nav>

      <aside className="sidebar">
        {panel === 'files' ? (
          <>
            <div className="sidebar-head">
              <strong style={{ fontSize: 13 }}>문서</strong>
            </div>
            <div className="sidebar-body">
              <FileTree activeSlug={activeSlug} />
            </div>
          </>
        ) : (
          <>
            <div className="sidebar-head">
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="문서 검색"
              />
            </div>
            <div className="sidebar-body">
              {searching && <p className="meta" style={{ padding: '4px 8px' }}>찾는 중…</p>}
              {!searching && q.trim().length >= 2 && hits.length === 0 && (
                <p className="meta" style={{ padding: '4px 8px' }}>결과 없음</p>
              )}
              {hits.map((h) => (
                <a key={h.slug} href={`/wiki/${h.slug}`} className="result">
                  <span className="t">{h.title}</span>
                  {h.summary && <span>{h.summary.slice(0, 60)}</span>}
                </a>
              ))}
            </div>
          </>
        )}
        <div className="sidebar-foot">
          <span>wiki</span>
          <a href="/sources" style={{ color: 'inherit' }}>
            소스
          </a>
        </div>
      </aside>

      <section className="main">{children}</section>
    </div>
  )
}
