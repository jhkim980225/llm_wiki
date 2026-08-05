'use client'
import { useEffect, useState } from 'react'
import { lineDiff } from '@/lib/wiki/diff'

type Revision = {
  id: string
  version: number
  title: string
  content: string
  editSource: string
  createdAt: string
}

export function RevisionDrawer({
  slug,
  currentContent,
  onReverted,
  onClose,
}: {
  slug: string
  currentContent: string
  onReverted: () => void
  onClose: () => void
}) {
  const [items, setItems] = useState<Revision[]>([])
  const [picked, setPicked] = useState<Revision | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch(`/api/pages/${encodeURIComponent(slug)}/revisions`)
      .then((r) => r.json())
      .then((b) => setItems(b.items ?? []))
  }, [slug])

  const revert = async (version: number) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/pages/${encodeURIComponent(slug)}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      })
      if (res.ok) onReverted()
    } finally {
      setBusy(false)
    }
  }

  /** 사람·에이전트·되돌리기를 한눈에 구분한다. */
  const sourceMark: Record<string, string> = {
    user: '사람',
    agent: '⌬ 에이전트',
    revert: '↺ 되돌림',
    pipeline: '파이프라인',
  }

  return (
    <aside
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: 'min(460px, 100vw)',
        padding: 16,
        overflowY: 'auto',
        zIndex: 50,
        background: 'var(--bg-sidebar)',
        borderLeft: '1px solid var(--line)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 13 }}>편집 이력</strong>
        <button className="quiet" onClick={onClose}>
          닫기
        </button>
      </div>

      <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
        {items.map((r) => (
          <li
            key={r.id}
           
            style={{
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--line-soft)',
              padding: '0.55rem 0',
              marginTop: 0,
            }}
          >
            <button
              className="quiet"
              onClick={() => setPicked(r)}
              style={{
                textAlign: 'left',
                padding: '0.2em 0.3em',
                color: picked?.id === r.id ? 'var(--accent)' : 'var(--text-dim)',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                v{r.version}
              </span>
              <span style={{ marginLeft: '0.6rem', fontSize: '0.78rem' }}>
                {sourceMark[r.editSource] ?? r.editSource}
              </span>
              <span className="meta" style={{ marginLeft: '0.6rem' }}>
                {new Date(r.createdAt).toLocaleString('ko-KR')}
              </span>
            </button>
            <button onClick={() => revert(r.version)} disabled={busy}>
              되돌리기
            </button>
          </li>
        ))}
        {items.length === 0 && (
          <li style={{ color: 'var(--text-faint)', fontSize: '0.88rem' }}>이전 버전이 없습니다.</li>
        )}
      </ul>

      {picked && (
        <>
          <p className="meta" style={{ marginTop: 16 }}>
            v{picked.version} → 현재
          </p>
          <pre className="diff">
            {lineDiff(picked.content, currentContent).map((l, i) => (
              <div key={i} className={l.type === 'same' ? undefined : l.type}>
                {l.type === 'add' ? '+ ' : l.type === 'del' ? '− ' : '  '}
                {l.text}
              </div>
            ))}
          </pre>
        </>
      )}
    </aside>
  )
}
