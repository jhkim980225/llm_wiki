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
      <div className="glass rise" style={{ maxWidth: '44rem', padding: '1.4rem' }}>
        <p className="eyebrow" style={{ color: 'var(--danger)' }}>
          저장 충돌
        </p>
        <h3>다른 곳에서 이 문서가 v{conflict.serverVersion}로 바뀌었습니다</h3>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
          서버 본문 기준으로 내 편집이 더한 줄(+)과 지운 줄(−)입니다. 자동으로 합치지 않습니다.
        </p>
        <pre className="diff">
          {diff.map((l, i) => (
            <div key={i} className={l.type === 'same' ? undefined : l.type}>
              {l.type === 'add' ? '+ ' : l.type === 'del' ? '− ' : '  '}
              {l.text}
            </div>
          ))}
        </pre>
        <div className="row" style={{ marginTop: '1rem' }}>
          <button className="primary" onClick={() => save(conflict.serverVersion)} disabled={saving}>
            내 편집으로 덮어쓰기
          </button>
          <button className="ghost" onClick={() => setConflict(null)}>
            돌아가기
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="stack rise" style={{ maxWidth: '44rem' }}>
      <span className="eyebrow">편집 중 · v{page.version}</span>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="제목"
        style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700 }}
      />
      <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="한 줄 요약" />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={24}
        placeholder="마크다운. 다른 문서는 [[slug]] 또는 [[slug|표시명]]으로 잇습니다."
      />
      {error && <span className="notice">{error}</span>}
      <div className="row">
        <button className="primary" onClick={() => save(page.version)} disabled={saving}>
          {saving ? '저장 중…' : '저장'}
        </button>
        <button className="ghost" onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  )
}
