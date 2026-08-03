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

  return (
    <aside
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: 480,
        background: '#fff',
        borderLeft: '1px solid #e0e0e0',
        padding: 16,
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>편집 이력</h3>
        <button onClick={onClose}>닫기</button>
      </div>

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {items.map((r) => (
          <li key={r.id} style={{ borderBottom: '1px solid #eee', padding: '8px 0' }}>
            <button onClick={() => setPicked(r)} style={{ all: 'unset', cursor: 'pointer' }}>
              v{r.version} · {r.editSource} · {new Date(r.createdAt).toLocaleString('ko-KR')}
            </button>
            <button onClick={() => revert(r.version)} disabled={busy} style={{ marginLeft: 8 }}>
              되돌리기
            </button>
          </li>
        ))}
        {items.length === 0 && <li style={{ color: '#5f6368' }}>이전 버전이 없습니다.</li>}
      </ul>

      {picked && (
        <>
          <h4>v{picked.version} → 현재</h4>
          <pre style={{ background: '#f6f8fa', padding: 12, overflowX: 'auto', fontSize: 12 }}>
            {lineDiff(picked.content, currentContent).map((l, i) => (
              <div
                key={i}
                style={{
                  background:
                    l.type === 'add' ? '#e6ffed' : l.type === 'del' ? '#ffeef0' : undefined,
                }}
              >
                {l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}
                {l.text}
              </div>
            ))}
          </pre>
        </>
      )}
    </aside>
  )
}
