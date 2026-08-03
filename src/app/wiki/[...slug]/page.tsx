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
  const [creating, setCreating] = useState({ title: slug.split('/').pop() ?? slug, content: '' })

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
      body: JSON.stringify({ slug, title: creating.title, content: creating.content }),
    })
    if (res.ok) {
      setMissing(false)
      await load()
    }
  }

  if (missing) {
    return (
      <main className="shell">
        <div className="stack rise glass" style={{ maxWidth: '44rem', padding: '1.5rem', marginTop: '2rem' }}>
          <span className="eyebrow">빈 자리</span>
          <h2 style={{ margin: 0 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9em', color: 'var(--accent)' }}>
              {slug}
            </span>
            <br />
            아직 아무도 쓰지 않았습니다
          </h2>
          <input
            value={creating.title}
            onChange={(e) => setCreating({ ...creating, title: e.target.value })}
            placeholder="제목"
          />
          <textarea
            value={creating.content}
            onChange={(e) => setCreating({ ...creating, content: e.target.value })}
            rows={14}
            placeholder="마크다운. [[slug]]로 다른 문서와 잇습니다."
          />
          <div className="row">
            <button className="primary" onClick={create}>
              이 이름으로 생성
            </button>
            <a href="/graph" className="meta" style={{ marginLeft: '0.4rem' }}>
              그래프로 돌아가기
            </a>
          </div>
        </div>
      </main>
    )
  }

  if (!page) {
    return (
      <main className="shell">
        <p className="eyebrow" style={{ marginTop: '2rem' }}>
          불러오는 중…
        </p>
      </main>
    )
  }

  return (
    <main className="shell">
      <nav className="row" style={{ margin: '0.6rem 0 1.6rem' }}>
        <span className="meta">{slug}</span>
        <span style={{ flex: 1 }} />
        <button className="ghost" onClick={() => setShowRevisions(true)}>
          편집 이력
        </button>
      </nav>

      {editing ? (
        <PageEditor
          page={page}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false)
            await load()
          }}
        />
      ) : (
        <PageView page={page} onEdit={() => setEditing(true)} />
      )}

      {showRevisions && (
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
    </main>
  )
}
