'use client'
import { useState } from 'react'
import { FlaskConical, Play } from 'lucide-react'
import { Markdown } from '@/components/wiki/Markdown'

const MODES = [
  { id: 'hybrid', desc: '개체 + 주제 결합 (기본)' },
  { id: 'local', desc: '개체 중심' },
  { id: 'global', desc: '관계·주제 중심' },
  { id: 'naive', desc: '벡터 검색만' },
  { id: 'mix', desc: '그래프 + 벡터 통합' },
]

/**
 * LightRAG PoC 테스트 화면 — 클러스터의 LightRAG 서버에 질문을 던져
 * 기존 /ask·채팅과 답변을 눈으로 비교한다. 실험용 탭 (docs/light-rag/).
 * 색인은 화면에 없다 — scripts/lightrag-seed.py가 담당.
 */
export default function LightragPage() {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('hybrid')
  const [answer, setAnswer] = useState<string | null>(null)
  const [tookMs, setTookMs] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!query.trim() || busy) return
    setBusy(true)
    setError(null)
    setAnswer(null)
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
        setTookMs(body.durationMs ?? null)
      }
    } catch {
      setError('요청 실패 — 네트워크를 확인하세요')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="tabbar">
        <div className="tab on">
          <FlaskConical size={14} aria-hidden />
          <span className="name">LightRAG 테스트</span>
        </div>
        <span className="center">색인된 문서에 질문해 기존 AI 작성·채팅과 비교하는 실험 화면입니다</span>
      </div>

      <div className="doc">
        <div className="doc-inner">
          <h1 className="doc-title" style={{ fontSize: 24 }}>LightRAG에 질문</h1>
          <div className="flow-form">
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run()
              }}
              rows={3}
              placeholder="질문 (예: 코바상사와의 거래는 어떤 내용인가?) — Ctrl+Enter 실행"
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
            </div>
          )}
        </div>
      </div>
    </>
  )
}
