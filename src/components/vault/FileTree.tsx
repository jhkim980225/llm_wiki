'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, FileText, Folder, FolderPlus, MoreHorizontal, Plus } from 'lucide-react'
import { Button, IconButton, SearchInput, TreeItem } from '@/components/ui'
import { Menu, anchorOf, type Anchor } from './Dialog'
import { useVaultAction, type Pending } from './actions'
import { normalizeSlug } from '@/lib/wiki/slug'

type FolderRow = { id: string; name: string; count: number }
type PageRow = { slug: string; title: string }
type Level = { folders: FolderRow[]; pages: PageRow[]; total: number; hasMore: boolean }

/** 드래그 중인 항목. dataTransfer에 JSON으로 실어 나른다. */
type DragItem = { kind: 'page'; slug: string } | { kind: 'folder'; id: string }
const DND_TYPE = 'application/x-wiki-item'

function readDragItem(e: React.DragEvent): DragItem | null {
  try {
    const raw = e.dataTransfer.getData(DND_TYPE)
    return raw ? (JSON.parse(raw) as DragItem) : null
  } catch {
    return null
  }
}

/* 브라우저 기본 드래그 프리뷰(제목+URL 회색 박스)를 없애는 투명 1px 캔버스.
   이미지와 달리 로드 지연이 없어 첫 드래그부터 확실히 먹는다. */
let ghost: HTMLCanvasElement | null = null
function transparentGhost(): HTMLCanvasElement {
  if (!ghost) {
    ghost = document.createElement('canvas')
    ghost.width = 1
    ghost.height = 1
  }
  return ghost
}

/** 드래그 시작 공통 처리 — payload 적재 + 기본 고스트 제거. preventDefault는 하지 않는다. */
function startDrag(e: React.DragEvent, item: DragItem) {
  e.dataTransfer.setData(DND_TYPE, JSON.stringify(item))
  // 문서/폴더 ID는 다른 소비자(디버깅·외부 드롭)를 위해 평문으로도 싣는다
  e.dataTransfer.setData('text/plain', item.kind === 'page' ? item.slug : item.id)
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setDragImage(transparentGhost(), 0, 0)
}

async function loadLevel(folderId: string | null, offset = 0, all = false): Promise<Level> {
  const q = new URLSearchParams({ offset: String(offset) })
  if (folderId) q.set('folderId', folderId)
  if (all) q.set('all', '1')
  const r = await fetch(`/api/tree?${q}`)
  return r.json()
}

/** 한 폴더 안. 펼칠 때만 자식을 불러온다 — 문서가 수만 건이라 통째로 못 내린다. */
function Branch({
  folderId,
  depth,
  activeSlug,
  tick,
  act,
  all,
  onMove,
}: {
  folderId: string | null
  depth: number
  activeSlug: string
  tick: number
  act: (p: Pending) => void
  all: boolean
  onMove: (item: DragItem, folderId: string | null) => void
}) {
  const [level, setLevel] = useState<Level | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [menu, setMenu] = useState<{ key: string; at: Anchor } | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  // 드래그 중인 행 — 배경·투명도로만 표시하고 마우스 추종 프리뷰는 없다
  const [dragKey, setDragKey] = useState<string | null>(null)

  // tick이 오르면 마운트된 Branch가 저마다 자기 레벨만 다시 부른다.
  // 아무것도 언마운트되지 않으므로 펼침 상태가 살아남는다.
  useEffect(() => {
    loadLevel(folderId, 0, all).then(setLevel)
  }, [folderId, tick, all])

  const more = useCallback(async () => {
    if (!level) return
    setLoading(true)
    const next = await loadLevel(folderId, level.pages.length, all)
    setLevel({ ...next, pages: [...level.pages, ...next.pages] })
    setLoading(false)
  }, [folderId, level, all])

  if (!level) return null

  return (
    <>
      {level.folders.map((f) => {
        const isOpen = open.has(f.id)
        return (
          <div key={f.id}>
            <div
              className={`row${dragKey === f.id ? ' dragging' : ''}`}
              draggable
              onDragStart={(e) => {
                startDrag(e, { kind: 'folder', id: f.id })
                setDragKey(f.id)
              }}
              onDragEnd={() => setDragKey(null)}
            >
              <TreeItem
                indent={depth}
                chevron={isOpen ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
                icon={<Folder size={14} aria-hidden />}
                name={f.name}
                count={f.count}
                dropInto={dropId === f.id}
                aria-expanded={isOpen}
                draggable={false}
                onDragOver={(e: React.DragEvent) => {
                  if (!e.dataTransfer.types.includes(DND_TYPE)) return
                  e.preventDefault()
                  e.stopPropagation()
                  e.dataTransfer.dropEffect = 'move'
                  setDropId(f.id)
                }}
                onDragLeave={() => setDropId((d) => (d === f.id ? null : d))}
                onDrop={(e: React.DragEvent) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setDropId(null)
                  const item = readDragItem(e)
                  if (!item) return
                  if (item.kind === 'folder' && item.id === f.id) return
                  onMove(item, f.id)
                }}
                onClick={() =>
                  setOpen((prev) => {
                    const n = new Set(prev)
                    if (n.has(f.id)) n.delete(f.id)
                    else n.add(f.id)
                    return n
                  })
                }
              />
              <button
                className={`row-menu${menu?.key === f.id ? ' on' : ''}`}
                aria-label="폴더 메뉴"
                title="폴더 메뉴"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenu(menu?.key === f.id ? null : { key: f.id, at: anchorOf(e.currentTarget) })
                }}
              >
                <MoreHorizontal size={14} />
              </button>
              {menu?.key === f.id && (
                <Menu
                  at={menu.at}
                  onClose={() => setMenu(null)}
                  items={[
                    { label: '새 문서', run: () => act({ kind: 'page-new', folderId: f.id }) },
                    { label: '새 하위 폴더', run: () => act({ kind: 'folder-new', parentId: f.id }) },
                    { label: '이름 바꾸기', run: () => act({ kind: 'folder-rename', id: f.id, name: f.name }) },
                    { label: '옮기기', run: () => act({ kind: 'folder-move', id: f.id }) },
                    { label: '삭제', danger: true, run: () => act({ kind: 'folder-delete', id: f.id, name: f.name }) },
                  ]}
                />
              )}
            </div>
            {isOpen && (
              <Branch folderId={f.id} depth={depth + 1} activeSlug={activeSlug} tick={tick} act={act} all={all} onMove={onMove} />
            )}
          </div>
        )
      })}

      {level.pages.map((p) => (
        <div
          className={`row${dragKey === p.slug ? ' dragging' : ''}`}
          key={p.slug}
          draggable
          onDragStart={(e) => {
            startDrag(e, { kind: 'page', slug: p.slug })
            setDragKey(p.slug)
          }}
          onDragEnd={() => setDragKey(null)}
        >
          <TreeItem
            as="a"
            href={`/wiki/${p.slug}`}
            indent={depth + 1}
            icon={<FileText size={14} aria-hidden />}
            name={p.title}
            active={p.slug === activeSlug}
            title={p.slug}
            draggable={false}
          />
          <button
            className={`row-menu${menu?.key === p.slug ? ' on' : ''}`}
            aria-label="문서 메뉴"
            title="문서 메뉴"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMenu(menu?.key === p.slug ? null : { key: p.slug, at: anchorOf(e.currentTarget) })
            }}
          >
            <MoreHorizontal size={14} />
          </button>
          {menu?.key === p.slug && (
            <Menu
              at={menu.at}
              onClose={() => setMenu(null)}
              items={[
                { label: '이름 바꾸기', run: () => act({ kind: 'page-rename', slug: p.slug }) },
                { label: '옮기기', run: () => act({ kind: 'page-move', slug: p.slug }) },
                { label: '삭제', danger: true, run: () => act({ kind: 'page-delete', slug: p.slug, title: p.title }) },
              ]}
            />
          )}
        </div>
      ))}

      {level.hasMore && (
        <button className="tree-more" style={{ marginLeft: 8 + (depth + 1) * 16 }} onClick={more} disabled={loading}>
          {loading ? '…' : `더 보기 (${(level.total - level.pages.length).toLocaleString('ko-KR')})`}
        </button>
      )}
    </>
  )
}

type Hit = { slug: string; title: string; summary: string }

export function FileTree({ activeSlug }: { activeSlug: string }) {
  const [tick, setTick] = useState(0)
  // 온톨로지 적재본은 소스 하나가 수만 건이라 기본으로 감춘다. 찾을 수는 있어야 한다.
  const [all, setAll] = useState(false)

  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [searching, setSearching] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const router = useRouter()

  const { start, dialog, error, clearError } = useVaultAction((p, value) => {
    // 트리는 늘 다시 그린다 — 만들든 지우든 목록이 바뀐다.
    setTick((t) => t + 1)
    if (p.kind === 'page-new' || (p.kind === 'page-rename' && p.slug === activeSlug)) {
      router.push(`/wiki/${normalizeSlug(value)}`)
    }
  })

  // 드래그앤드롭 이동. 실패(폴더 순환 등)는 서버가 판정하고 여기서 알림으로 띄운다.
  const [moveError, setMoveError] = useState<string | null>(null)

  const onMove = useCallback(async (item: DragItem, folderId: string | null) => {
    setMoveError(null)
    const res =
      item.kind === 'page'
        ? await fetch(`/api/pages/${encodeURIComponent(item.slug)}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderId }),
          })
        : await fetch(`/api/folders/${item.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parentId: folderId }),
          })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setMoveError(body.error ?? `이동 실패 (HTTP ${res.status})`)
      return
    }
    setTick((t) => t + 1)
  }, [])

  // 트리 밖에서 문서가 생기거나 바뀌면(편집기 저장, /ask 자동 저장, 도우미 편집)
  // 'wiki:refresh' 이벤트로 알려온다 — 트리는 다시 그리기만 한다.
  useEffect(() => {
    const refresh = () => setTick((t) => t + 1)
    window.addEventListener('wiki:refresh', refresh)
    return () => window.removeEventListener('wiki:refresh', refresh)
  }, [])

  // Ctrl+K 검색 · Ctrl+N 새 문서
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (k === 'n' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        start({ kind: 'page-new', folderId: null })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const showResults = q.trim().length >= 2

  return (
    <>
      <div className="sidebar-head">
        <strong>문서</strong>
        <Button variant="primary" size="sm" style={{ height: 30 }} onClick={() => start({ kind: 'page-new', folderId: null })}>
          <Plus size={14} aria-hidden /> 새 문서
        </Button>
        <IconButton label="새 폴더" onClick={() => start({ kind: 'folder-new', parentId: null })}>
          <FolderPlus size={16} />
        </IconButton>
      </div>

      <div className="sidebar-search">
        <SearchInput
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="문서 검색"
          aria-label="문서 검색"
          kbd="Ctrl K"
        />
      </div>

      <div
        className="sidebar-body"
        // 빈 공간에 떨구면 최상위로 이동한다. 폴더 행 위 드롭은 행이 stopPropagation으로 가로챈다.
        // 시각 강조는 폴더 행(drop-into)만 — 영역 전체 테두리는 과해서 뺐다.
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DND_TYPE)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(e) => {
          e.preventDefault()
          const item = readDragItem(e)
          if (item) onMove(item, null)
        }}
        // 키보드 트리 탐색. 상태 없이 document.activeElement 기준으로 다음/이전
        // 보이는 .tree-item을 찾아 focus()만 옮긴다 — 폴더 펼침 여부는 이미 DOM에 반영돼 있다.
        onKeyDown={(e) => {
          if (!e.currentTarget.contains(document.activeElement)) return
          const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('.tree-item'))
          const idx = items.indexOf(document.activeElement as HTMLElement)
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            items[idx === -1 ? 0 : Math.min(idx + 1, items.length - 1)]?.focus()
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            items[idx === -1 ? items.length - 1 : Math.max(idx - 1, 0)]?.focus()
          } else if (idx === -1) {
            return
          } else if (e.key === 'ArrowRight') {
            const el = items[idx]
            if (el.getAttribute('aria-expanded') === 'false') {
              e.preventDefault()
              el.click()
            }
          } else if (e.key === 'ArrowLeft') {
            const el = items[idx]
            if (el.getAttribute('aria-expanded') === 'true') {
              e.preventDefault()
              el.click()
            }
          }
        }}
      >
        {error && (
          <p className="notice" style={{ padding: '4px 8px' }} onClick={clearError}>
            {error}
          </p>
        )}
        {moveError && (
          <p className="notice" style={{ padding: '4px 8px' }} onClick={() => setMoveError(null)}>
            {moveError}
          </p>
        )}
        {showResults ? (
          <>
            {searching && <p className="meta" style={{ padding: '4px 8px' }}>찾는 중…</p>}
            {!searching && hits.length === 0 && <p className="meta" style={{ padding: '4px 8px' }}>결과 없음</p>}
            {hits.map((h) => (
              <a key={h.slug} href={`/wiki/${h.slug}`} className="result">
                <span className="t">{h.title}</span>
                {h.summary && <span>{h.summary.slice(0, 60)}</span>}
              </a>
            ))}
          </>
        ) : (
          <Branch folderId={null} depth={0} activeSlug={activeSlug} tick={tick} act={start} all={all} onMove={onMove} />
        )}
      </div>

      <div className="sidebar-foot">
        <button className={`quiet${all ? ' on' : ''}`} style={{ fontSize: 12 }} onClick={() => setAll((v) => !v)}>
          {all ? '적재본 감추기' : '적재본 보기'}
        </button>
        <span style={{ flex: 1 }} />
        <a href="/sources" style={{ color: 'inherit' }}>
          소스
        </a>
      </div>

      {dialog}
    </>
  )
}
