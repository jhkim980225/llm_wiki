'use client'
import { use, useCallback, useEffect, useState } from 'react'
import { PageView, type PageData } from '@/components/wiki/PageView'
import { PageEditor } from '@/components/wiki/PageEditor'
import { RevisionDrawer } from '@/components/wiki/RevisionDrawer'

export default function WikiPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug: parts } = use(params)
  const slug = parts.map(decodeURIComponent).join('/')

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
    setPage(await res.json())
  }, [slug])

  useEffect(() => {
    load()
  }, [load])

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
        <div className="tab">
          <span className="name">{page?.title ?? slug}</span>
        </div>
        <span className="center">{slug}</span>
        {page && (
          <button className="quiet" onClick={() => setShowRevisions(true)}>
            이력
          </button>
        )}
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
