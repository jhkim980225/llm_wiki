'use client'
import { useState } from 'react'
import { lineDiff } from '@/lib/wiki/diff'
import type { PageData } from './PageView'

type Conflict = { serverContent: string; serverVersion: number }
type Proposal = { content: string; added: { slug: string; title: string }[] }

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
  const [pageType, setPageType] = useState(page.pageType)
  const [aliases, setAliases] = useState(page.aliases.join(', '))
  const [content, setContent] = useState(page.content)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [linking, setLinking] = useState(false)
  const [proposal, setProposal] = useState<Proposal | null>(null)

  const proposeLinks = async () => {
    setLinking(true)
    setError(null)
    try {
      const res = await fetch(`/api/pages/${encodeURIComponent(page.slug)}/linkify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      if (!body.changed) {
        setError('본문에 이름이 나오는 다른 문서가 없습니다')
        return
      }
      setProposal({ content: body.content, added: body.added })
    } finally {
      setLinking(false)
    }
  }

  const save = async (expectedVersion: number) => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/pages/${encodeURIComponent(page.slug)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion,
          title,
          summary,
          content,
          pageType: pageType.trim() || 'concept',
          aliases: aliases
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }),
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

  if (proposal) {
    const diff = lineDiff(content, proposal.content)
    return (
      <div style={{ maxWidth: 700 }}>
        <h3>링크 {proposal.added.length}개를 잇습니다</h3>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
          본문에 이름이 나오는 문서의 첫 출현만 감쌉니다. 코드 블록과 이미 걸린 링크는 건드리지
          않습니다. 적용해도 저장되지는 않습니다.
        </p>
        <p className="meta" style={{ marginBottom: 10 }}>
          {proposal.added.map((a) => a.title).join(' · ')}
        </p>
        <pre className="diff">
          {diff.map((l, i) => (
            <div key={i} className={l.type === 'same' ? undefined : l.type}>
              {l.type === 'add' ? '+ ' : l.type === 'del' ? '− ' : '  '}
              {l.text}
            </div>
          ))}
        </pre>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            className="primary"
            onClick={() => {
              setContent(proposal.content)
              setProposal(null)
            }}
          >
            적용
          </button>
          <button className="quiet" onClick={() => setProposal(null)}>
            취소
          </button>
        </div>
      </div>
    )
  }

  if (conflict) {
    const diff = lineDiff(conflict.serverContent, content)
    return (
      <div style={{ maxWidth: 700 }}>
        <p className="notice">저장 충돌</p>
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
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="primary" onClick={() => save(conflict.serverVersion)} disabled={saving}>
            내 편집으로 덮어쓰기
          </button>
          <button className="quiet" onClick={() => setConflict(null)}>
            돌아가기
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 8, maxWidth: 700 }}>
      <span className="meta">편집 중 · v{page.version}</span>
      {page.lastEditSource === 'ontology' && (
        <span className="notice">
          온톨로지가 만든 문서입니다. 저장하면 사람이 편집한 문서가 되어, 다음 Fuseki 적재 때
          이 문서는 갱신되지 않고 건너뜁니다.
        </span>
      )}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="제목"
        style={{ fontSize: '1.2rem', fontWeight: 600 }}
      />
      <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="한 줄 요약" />
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={pageType}
          onChange={(e) => setPageType(e.target.value)}
          placeholder="유형 (예: concept, synthesis)"
          style={{ flex: '0 0 40%' }}
        />
        <input
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          placeholder="별칭 (쉼표로 구분)"
          style={{ flex: 1 }}
        />
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={24}
        placeholder="마크다운. 다른 문서는 [[slug]] 또는 [[slug|표시명]]으로 잇습니다."
      />
      {error && <span className="notice">{error}</span>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="primary" onClick={() => save(page.version)} disabled={saving}>
          {saving ? '저장 중…' : '저장'}
        </button>
        <button className="quiet" onClick={proposeLinks} disabled={linking || saving}>
          {linking ? '찾는 중…' : '링크 잇기'}
        </button>
        <button className="quiet" onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  )
}
