'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlaskConical, Play, RefreshCw } from 'lucide-react'
import { Markdown } from '@/components/wiki/Markdown'
import { IconButton } from '@/components/ui'

const MODES = [
  { id: 'hybrid', desc: '개체 + 주제 결합 (기본)' },
  { id: 'local', desc: '개체 중심' },
  { id: 'global', desc: '관계·주제 중심' },
  { id: 'naive', desc: '벡터 검색만' },
  { id: 'mix', desc: '그래프 + 벡터 통합' },
]

type Status = {
  status: string | null
  coreVersion: string | null
  llmModel: string | null
  summaryLanguage: string | null
  counts: Record<string, number>
  busy: boolean | null
}
type Doc = { id: string; status: string; length: number | null; updatedAt: string | null; error: string | null }
type Ref = { id: string; doc: string }

const STATUS_ORDER: Record<string, number> = { failed: 0, processing: 1, pending: 2, processed: 3 }

function statusColor(s: string) {
  if (s === 'processed') return 'var(--text-dim)'
  if (s === 'failed') return 'var(--danger)'
  return 'var(--warn)'
}

/**
 * LightRAG PoC 확인 화면 — 질의 테스트에 더해 색인 상태·문서 목록·그래프 라벨을
 * 눈으로 검증한다. 실험용 탭 (docs/light-rag/). 색인 자체는 화면에 없다 —
 * scripts/lightrag-wiki-seed.py가 담당.
 */
export default function LightragPage() {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('hybrid')
  const [answer, setAnswer] = useState<string | null>(null)
  const [refs, setRefs] = useState<Ref[]>([])
  const [tookMs, setTookMs] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [status, setStatus] = useState<Status | null>(null)
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [labels, setLabels] = useState<string[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [labelQuery, setLabelQuery] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [s, d, l] = await Promise.all([
        fetch('/api/lightrag?view=status').then((r) => r.json()),
        fetch('/api/lightrag?view=documents').then((r) => r.json()),
        fetch('/api/lightrag?view=labels').then((r) => r.json()),
      ])
      if (s.error || d.error || l.error) setLoadError(s.error ?? d.error ?? l.error)
      if (!s.error) setStatus(s)
      if (!d.error) setDocs(d.documents)
      if (!l.error) setLabels(l.labels)
    } catch {
      setLoadError('상태 조회 실패 — 네트워크를 확인하세요')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const run = async () => {
    if (!query.trim() || busy) return
    setBusy(true)
    setError(null)
    setAnswer(null)
    setRefs([])
    setTookMs(null)
    try {
      const res = await fetch('/api/lightrag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, mode }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) setError(body.error ?? `HTTP ${res.status}`)
      else {
        setAnswer(body.response || '(빈 응답)')
        setRefs(body.references ?? [])
        setTookMs(body.durationMs ?? null)
      }
    } catch {
      setError('요청 실패 — 네트워크를 확인하세요')
    } finally {
      setBusy(false)
    }
  }

  const sortedDocs = useMemo(
    () =>
      (docs ?? [])
        .slice()
        .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.id.localeCompare(b.id)),
    [docs],
  )
  const failedCount = useMemo(() => (docs ?? []).filter((d) => d.status === 'failed').length, [docs])
  const labelHits = useMemo(() => {
    if (!labels || !labelQuery.trim()) return []
    const q = labelQuery.trim().toLowerCase()
    return labels.filter((l) => l.toLowerCase().includes(q))
  }, [labels, labelQuery])

  return (
    <>
      <div className="tabbar">
        <div className="tab on">
          <FlaskConical size={14} aria-hidden />
          <span className="name">LightRAG 테스트</span>
        </div>
        <span className="center">색인 상태를 확인하고 질문을 던져 정합성을 검증하는 실험 화면입니다</span>
      </div>

      <div className="doc">
        <div className="doc-inner">
          <h1 className="doc-title" style={{ fontSize: 24 }}>LightRAG 확인</h1>

          {/* 상태 줄 */}
          <p className="meta" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {status ? (
              <>
                <span style={{ color: status.status === 'healthy' ? 'var(--accent)' : 'var(--danger)' }}>
                  {status.status === 'healthy' ? '서버 정상' : `서버 ${status.status ?? '?'}`}
                </span>
                {status.llmModel && <span>{status.llmModel}</span>}
                {status.summaryLanguage && <span>언어 {status.summaryLanguage}</span>}
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {Object.entries(status.counts)
                    .filter(([k]) => k !== 'all')
                    .map(([k, v]) => `${k} ${v}`)
                    .join(' · ') || '색인 0건'}
                </span>
                {status.busy != null && <span>{status.busy ? '파이프라인 처리 중' : '파이프라인 유휴'}</span>}
              </>
            ) : (
              <span>{loading ? '상태 조회 중…' : (loadError ?? '상태 미확인')}</span>
            )}
            <IconButton label="상태 새로고침" onClick={load} disabled={loading}>
              <RefreshCw size={14} aria-hidden />
            </IconButton>
          </p>
          {loadError && status && (
            <p className="meta" style={{ color: 'var(--danger)' }}>{loadError}</p>
          )}

          {/* 질의 */}
          <div className="flow-form" style={{ marginTop: 20 }}>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run()
              }}
              rows={3}
              placeholder="질문 (예: 성진의 대표이사는 누구고 어떤 사업을 해?) — Ctrl+Enter 실행"
              aria-label="질문"
            />
            <div className="row">
              <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="검색 모드">
                {MODES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id} — {m.desc}
                  </option>
                ))}
              </select>
              <span className="grow" />
              {tookMs !== null && <span className="meta">{(tookMs / 1000).toFixed(1)}초</span>}
              <button className="primary" onClick={run} disabled={busy || !query.trim()}>
                <Play size={13} aria-hidden /> {busy ? '질의 중…' : '질문'}
              </button>
            </div>
          </div>

          {error && <p className="meta" style={{ color: 'var(--danger)', marginTop: 16 }}>{error}</p>}
          {busy && <p className="meta" style={{ marginTop: 16 }}>LightRAG가 답변을 만드는 중 — 수십 초 걸릴 수 있습니다.</p>}
          {answer && (
            <div style={{ marginTop: 24 }}>
              <Markdown content={answer} />
              {refs.length > 0 && (
                <p className="meta" style={{ marginTop: 12 }}>
                  참조 {refs.length}건: {refs.map((r) => r.doc).join(' · ')}
                </p>
              )}
            </div>
          )}

          {/* 색인 문서 */}
          <h2 style={{ fontSize: 18, fontWeight: 650, marginTop: 40 }}>
            색인 문서{docs ? ` ${docs.length}건` : ''}
            {failedCount > 0 && <span style={{ color: 'var(--danger)', fontSize: 13, marginLeft: 8 }}>실패 {failedCount}건</span>}
          </h2>
          {docs === null ? (
            <p className="meta">{loading ? '불러오는 중…' : '조회 실패'}</p>
          ) : (
            <div style={{ maxHeight: 400, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
              <table className="status">
                <tbody>
                  {sortedDocs.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <span className="t" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{d.id}</span>
                        {d.error && <span className="meta" style={{ color: 'var(--danger)' }}>{d.error}</span>}
                      </td>
                      <td className="num" style={{ color: statusColor(d.status) }}>{d.status}</td>
                      <td className="num">{d.length != null ? `${d.length.toLocaleString()}자` : ''}</td>
                      <td className="num">{d.updatedAt ? d.updatedAt.slice(0, 16).replace('T', ' ') : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 라벨 검색 */}
          <h2 style={{ fontSize: 18, fontWeight: 650, marginTop: 40 }}>
            그래프 라벨{labels ? ` ${labels.length.toLocaleString()}개` : ''}
          </h2>
          <p className="meta">개체명이 어떻게 추출됐는지 확인합니다 — 같은 대상의 표기 변형(분신)이 있는지 검색해 보세요.</p>
          <input
            value={labelQuery}
            onChange={(e) => setLabelQuery(e.target.value)}
            placeholder="라벨 검색 (예: 성진)"
            aria-label="라벨 검색"
            style={{ width: 280 }}
          />
          {labelQuery.trim() && (
            <p className="meta" style={{ marginTop: 10, lineHeight: 1.8 }}>
              {labelHits.length === 0
                ? '일치하는 라벨 없음'
                : `${labelHits.length}개: ${labelHits.slice(0, 50).join(' · ')}${labelHits.length > 50 ? ` 외 ${labelHits.length - 50}개` : ''}`}
            </p>
          )}
        </div>
      </div>
    </>
  )
}
