'use client'
import { useCallback, useEffect, useState } from 'react'
import { FileText, Folder, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui'

type Item = { kind: 'page' | 'folder'; id: string; name: string; deletedAt: string }

/** 남은 보존 일수. 0이면 다음 퍼지 때 사라진다. */
function daysLeft(deletedAt: string, retention: number): number {
  const gone = new Date(deletedAt).getTime() + retention * 24 * 60 * 60 * 1000
  return Math.max(0, Math.ceil((gone - Date.now()) / (24 * 60 * 60 * 1000)))
}

export default function TrashPage() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [retention, setRetention] = useState(7)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/trash')
    const body = await res.json()
    setItems(body.items ?? [])
    setRetention(body.retentionDays ?? 7)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const restore = async (it: Item) => {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/trash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: it.kind, id: it.id }),
    })
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
    await load()
    setBusy(false)
  }

  const empty = async () => {
    if (!window.confirm('휴지통을 비웁니다. 되돌릴 수 없습니다.')) return
    setBusy(true)
    await fetch('/api/trash', { method: 'DELETE' })
    await load()
    setBusy(false)
  }

  return (
    <>
      <div className="tabbar">
        <div className="tab on">
          <span className="name">휴지통</span>
        </div>
        <span className="center">삭제된 문서와 폴더는 {retention}일 뒤 영구 삭제됩니다</span>
        <span className="side">
          {items && items.length > 0 && (
            <button className="quiet" onClick={empty} disabled={busy}>
              <Trash2 size={14} aria-hidden /> 비우기
            </button>
          )}
        </span>
      </div>

      <div className="doc">
        <div className="doc-inner">
          {error && <p className="notice">{error}</p>}
          {!items && <p className="meta">불러오는 중…</p>}
          {items && items.length === 0 && <p className="meta">휴지통이 비어 있습니다.</p>}

          {items && items.length > 0 && (
            <div className="trash-list">
              {items.map((it) => (
                <div key={`${it.kind}:${it.id}`} className="trash-row">
                  {it.kind === 'folder' ? <Folder size={15} aria-hidden /> : <FileText size={15} aria-hidden />}
                  <span className="name" title={it.kind === 'page' ? it.id : undefined}>
                    {it.name}
                  </span>
                  <span className="meta">
                    {new Date(it.deletedAt).toLocaleDateString('ko-KR')} 삭제 · {daysLeft(it.deletedAt, retention)}일 남음
                  </span>
                  <Button size="sm" disabled={busy} onClick={() => restore(it)}>
                    <RotateCcw size={13} aria-hidden /> 복원
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
