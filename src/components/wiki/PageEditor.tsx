'use client'
import { useState } from 'react'
import { lineDiff } from '@/lib/wiki/diff'
import type { PageData } from './PageView'

type Conflict = { serverContent: string; serverVersion: number }

/**
 * 저장은 낙관적 잠금이다. 409를 받으면 서버 본문과의 diff를 보여주고
 * 덮어쓸지 취소할지 사용자에게 맡긴다 — 자동 병합하지 않는다.
 */
export function PageEditor({
  page,
  onSaved,
  onCancel,
}: {
  page: PageData
  onSaved: (updated: PageData) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(page.title)
  const [summary, setSummary] = useState(page.summary)
  const [content, setContent] = useState(page.content)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)

  const save = async (expectedVersion: number) => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/pages/${encodeURIComponent(page.slug)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion, title, summary, content }),
      })
      const body = await res.json()

      if (res.status === 409) {
        const fresh = await fetch(`/api/pages/${encodeURIComponent(page.slug)}`).then((r) => r.json())
        setConflict({ serverContent: fresh.content, serverVersion: body.currentVersion })
        return
      }
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      setConflict(null)
      onSaved(body)
    } finally {
      setSaving(false)
    }
  }

  if (conflict) {
    const diff = lineDiff(conflict.serverContent, content)
    return (
      <div style={{ maxWidth: 760 }}>
        <h3 style={{ color: '#c5221f' }}>
          다른 곳에서 이 페이지가 v{conflict.serverVersion}로 바뀌었습니다
        </h3>
        <p>서버 본문(위) 대비 내 편집(아래) 차이:</p>
        <pre style={{ background: '#f6f8fa', padding: 12, overflowX: 'auto' }}>
          {diff.map((l, i) => (
            <div
              key={i}
              style={{
                background: l.type === 'add' ? '#e6ffed' : l.type === 'del' ? '#ffeef0' : undefined,
              }}
            >
              {l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}
              {l.text}
            </div>
          ))}
        </pre>
        <button onClick={() => save(conflict.serverVersion)} disabled={saving}>
          내 편집으로 덮어쓰기
        </button>
        <button onClick={() => setConflict(null)}>돌아가기</button>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" />
      <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="한 줄 요약" />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={24}
        style={{ fontFamily: 'monospace', fontSize: 13 }}
        placeholder="마크다운. 다른 문서는 [[slug]] 또는 [[slug|표시명]]으로 잇습니다."
      />
      {error && <span style={{ color: '#c5221f' }}>{error}</span>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => save(page.version)} disabled={saving}>
          {saving ? '저장 중…' : '저장'}
        </button>
        <button onClick={onCancel}>취소</button>
      </div>
    </div>
  )
}
