'use client'
import { use, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DocumentTab } from '@/components/ui'
import { PageView, type PageData } from '@/components/wiki/PageView'
import { PageEditor } from '@/components/wiki/PageEditor'
import { RevisionDrawer } from '@/components/wiki/RevisionDrawer'
import { UNTITLED } from '@/components/vault/actions'

type Tab = { slug: string; title: string }

const MAX_TABS = 8

/**
 * 탭 목록은 localStorage에 산다.
 *
 * 이제는 next/link로 부드럽게 넘어가지만, 그래도 상태를 여기 두지 않는다 —
 * 새로고침·주소 직접 입력·뒤로가기 어느 쪽으로 들어와도 탭이 남아야 한다.
 */
function readTabs(): Tab[] {
  try {
    const raw = JSON.parse(localStorage.getItem('tabs') ?? '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

export default function WikiPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug: parts } = use(params)
  const slug = parts.map(decodeURIComponent).join('/')

  const router = useRouter()
  const [tabs, setTabs] = useState<Tab[]>([])
  const [page, setPage] = useState<PageData | null>(null)
  const [missing, setMissing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [showRevisions, setShowRevisions] = useState(false)
  const [draft, setDraft] = useState({ title: slug.split('/').pop() ?? slug, content: '' })

  const load = useCallback(async () => {
    const res = await fetch(`/api/pages/${encodeURIComponent(slug)}`)
    if (res.status === 404) {
      setMissing(true)
      setPage(null)
      return
    }
    setMissing(false)
    const p: PageData = await res.json()
    setPage(p)
    // 갓 만든 무제 문서는 바로 편집 모드로 — 노션처럼 제목부터 치게 한다.
    if (p.title === UNTITLED && !p.content) setEditing(true)
  }, [slug])

  useEffect(() => {
    load()
  }, [load])

  // 열린 문서를 탭에 등록한다. 이미 있으면 제목만 갱신해 자리를 지킨다.
  useEffect(() => {
    if (!page) return
    const prev = readTabs()
    const next = prev.some((t) => t.slug === slug)
      ? prev.map((t) => (t.slug === slug ? { slug, title: page.title } : t))
      : [...prev, { slug, title: page.title }].slice(-MAX_TABS)
    localStorage.setItem('tabs', JSON.stringify(next))
    setTabs(next)
  }, [slug, page])

  const closeTab = (target: string) => {
    const next = readTabs().filter((t) => t.slug !== target)
    localStorage.setItem('tabs', JSON.stringify(next))
    setTabs(next)
    if (target !== slug) return
    // 닫은 게 지금 보던 탭이면 옆 탭으로, 없으면 들머리로 나간다.
    router.push(next.length ? `/wiki/${next[next.length - 1].slug}` : '/')
  }

  const create = async () => {
    const res = await fetch('/api/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, title: draft.title, content: draft.content }),
    })
    if (res.ok) {
      setMissing(false)
      await load()
    }
  }

  return (
    <>
      <div className="tabbar">
        <div className="tabs">
          {(tabs.length ? tabs : [{ slug, title: page?.title ?? slug }]).map((t) => (
            <DocumentTab
              key={t.slug}
              title={t.title}
              href={`/wiki/${t.slug}`}
              active={t.slug === slug}
              onClose={() => closeTab(t.slug)}
            />
          ))}
        </div>
        <span className="center">
          {slug.split('/').map((part, i) => (
            <span key={i} style={{ display: 'contents' }}>
              {i > 0 && <span className="sep">›</span>}
              <span>{part}</span>
            </span>
          ))}
        </span>
        <span className="side">
          {page && (
            <button className="quiet" onClick={() => setShowRevisions(true)}>
              이력
            </button>
          )}
        </span>
      </div>

      <div className="doc" style={{ position: 'relative' }}>
        {missing && (
          <div className="doc-inner">
            <h1 style={{ fontSize: '1.6rem' }}>
              <code>{slug}</code> 문서가 없습니다
            </h1>
            <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="제목"
              />
              <textarea
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                rows={14}
                placeholder="마크다운. [[slug]]로 다른 문서와 잇습니다."
              />
              <div>
                <button className="primary" onClick={create}>
                  만들기
                </button>
              </div>
            </div>
          </div>
        )}

        {!missing && !page && <div className="empty">불러오는 중…</div>}

        {page &&
          (editing ? (
            <div className="doc-inner">
              <PageEditor
                page={page}
                onCancel={() => setEditing(false)}
                onSaved={async () => {
                  setEditing(false)
                  await load()
                }}
              />
            </div>
          ) : (
            <PageView page={page} onEdit={() => setEditing(true)} />
          ))}

        {page && (
          <div className="statusbar">
            <span>백링크 {page.backlinks.length}</span>
            <span>링크 {page.outLinks.length}</span>
          </div>
        )}
      </div>

      {showRevisions && page && (
        <RevisionDrawer
          slug={slug}
          currentContent={page.content}
          onClose={() => setShowRevisions(false)}
          onReverted={async () => {
            setShowRevisions(false)
            await load()
          }}
        />
      )}
    </>
  )
}
