'use client'
import { use, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquareText, Waypoints } from 'lucide-react'
import { DocumentTab } from '@/components/ui'
import { EntityGraph } from '@/components/graph/EntityGraph'
import { PageView, type PageData } from '@/components/wiki/PageView'
import { PageEditor } from '@/components/wiki/PageEditor'
import { RevisionDrawer } from '@/components/wiki/RevisionDrawer'
import { DocChatPanel } from '@/components/wiki/DocChatPanel'
import { UNTITLED } from '@/components/vault/actions'

type Tab = { slug: string; title: string }

/** 이 slug가 그래프 개체를 가리키고 있나. 있으면 문서가 없어도 그래프에서 만들 수 있다. */
type GraphRef = { name: string; type: string; sourceId: string; promoted: boolean }

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
  const [chatOpen, setChatOpen] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)
  const [ref, setRef] = useState<GraphRef | null>(null)
  const [promoting, setPromoting] = useState(false)
  const [promoteError, setPromoteError] = useState('')
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

  // 이 slug에 걸린 그래프 개체 참조. 문서 없음 화면의 분기와 [그래프] 토글 노출을 가른다.
  useEffect(() => {
    let stale = false
    setGraphOpen(false)
    setPromoteError('')
    fetch(`/api/graph-ref?slug=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : { ref: null }))
      .then((d) => !stale && setRef(d.ref ?? null))
      .catch(() => !stale && setRef(null))
    return () => {
      stale = true
    }
  }, [slug])

  const promote = async () => {
    setPromoting(true)
    setPromoteError('')
    const res = await fetch('/api/graph-ref/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    })
    setPromoting(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setPromoteError(body.error ?? '그래프에서 가져오지 못했습니다.')
      return
    }
    setMissing(false)
    await load()
  }

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
          {page && !editing && ref && (
            <button
              className={graphOpen ? 'quiet on' : 'quiet'}
              onClick={() => setGraphOpen((v) => !v)}
              title="개체 관계 그래프"
            >
              <Waypoints size={13} aria-hidden /> 그래프
            </button>
          )}
          {page && !editing && (
            <button
              className={chatOpen ? 'quiet on' : 'quiet'}
              onClick={() => setChatOpen((v) => !v)}
              title="문서에 질문"
            >
              <MessageSquareText size={13} aria-hidden /> 질문
            </button>
          )}
          {page && (
            <button className="quiet" onClick={() => setShowRevisions(true)}>
              이력
            </button>
          )}
        </span>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <div className={`doc${editing && page ? ' editing' : ''}`} style={{ position: 'relative', minWidth: 0 }}>
        {missing && (
          <div className="doc-inner">
            <h1 style={{ fontSize: '1.6rem' }}>
              <code>{slug}</code> 문서가 없습니다
            </h1>

            {/* 그래프에 있는 개체면 빈 문서를 쓰게 하지 않고 원본에서 끌어온다. */}
            {ref && (
              <div className="graphref-offer">
                <p>
                  <strong>{ref.name}</strong> 은(는) {ref.sourceId} 그래프에 있는 개체입니다.
                  관계와 속성을 끌어와 문서로 만들 수 있습니다.
                </p>
                <button className="primary" onClick={promote} disabled={promoting}>
                  <Waypoints size={13} aria-hidden />
                  {promoting ? '가져오는 중…' : '그래프에서 문서 만들기'}
                </button>
                {promoteError && <p className="err">{promoteError}</p>}
              </div>
            )}

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

        {page && !editing && graphOpen && <EntityGraph slug={slug} />}

        {page &&
          !graphOpen &&
          (editing ? (
            <PageEditor
              page={page}
              onCancel={() => setEditing(false)}
              onShowRevisions={() => setShowRevisions(true)}
              onSaved={async () => {
                setEditing(false)
                await load()
              }}
            />
          ) : (
            <PageView page={page} onEdit={() => setEditing(true)} />
          ))}

        {page && !editing && (
          <div className="statusbar">
            <span>백링크 {page.backlinks.length}</span>
            <span>링크 {page.outLinks.length}</span>
          </div>
        )}
      </div>

      {/* key={slug} — 문서를 옮기면 대화가 통째로 초기화된다 */}
      {chatOpen && page && !editing && (
        <DocChatPanel key={slug} slug={slug} onClose={() => setChatOpen(false)} />
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
