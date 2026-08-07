'use client'

import { useState } from 'react'
import { Scale, Play } from 'lucide-react'

type ApiAnswer = { id: string; name: string; ok: boolean; answer?: string; error?: string; ms: number }
type Digest = { id: string; name: string; text: string }
type SourceStatus = { id: string; name: string; ok: boolean; error?: string }
type SparqlQuery = { source: string; kind: string; term: string; sparql: string }
type Verdict = { source: string; verdict: string; reason: string }

type Result = {
  terms?: string[]
  answers?: ApiAnswer[]
  digests?: Digest[]
  sources?: SourceStatus[]
  counts?: { nodes: number; edges: number; textHits: number }
  queries?: SparqlQuery[]
  sparqlMs?: number
  verdicts?: Verdict[]
  summary?: string
  merged?: string
  error?: string
}

const EXAMPLES = [
  '주식회사 성진의 구성원은 누구야?',
  '정아라는 2026년 6월에 어떤 업무를 했어?',
  '글리세롤이 들어간 제품에는 뭐가 있어?',
]

const VERDICT_STYLE: Record<string, { color: string; bg: string }> = {
  일치: { color: 'var(--accent)', bg: 'rgba(45,212,191,.12)' },
  부분일치: { color: 'var(--warn)', bg: 'rgba(251,191,36,.12)' },
  불일치: { color: 'var(--danger)', bg: 'rgba(248,113,113,.12)' },
  판단불가: { color: 'var(--text-dim)', bg: 'var(--hover)' },
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const s = VERDICT_STYLE[verdict] ?? VERDICT_STYLE['판단불가']
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        color: s.color,
        background: s.bg,
        padding: '3px 8px',
        borderRadius: 6,
      }}
    >
      {verdict}
    </span>
  )
}

/**
 * 정합성 검증 — 같은 질문을 소스별 전용 RAG API와 SPARQL 직조회에 동시에 던져
 * 결과가 맞물리는지 LLM이 판정한다. API 도입 근거를 만들기 위한 테스트 화면.
 */
export default function VerifyPage() {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('')
  const [r, setR] = useState<Result | null>(null)

  const run = async (q: string) => {
    const question = q.trim()
    if (!question || busy) return
    setBusy(true)
    setR({})
    setStage('용어 추출 중…')
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}))
        setR({ error: body.error ?? `HTTP ${res.status}` })
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const ev = JSON.parse(line)
          if (ev.stage === 'terms') {
            setR((p) => ({ ...p, terms: ev.terms }))
            setStage('두 경로 동시 조회 중… (API 3소스 + SPARQL, 수십 초)')
          } else if (ev.stage === 'api') {
            setR((p) => ({ ...p, answers: ev.answers }))
          } else if (ev.stage === 'sparql') {
            setR((p) => ({
              ...p,
              digests: ev.digests,
              sources: ev.sources,
              counts: ev.counts,
              queries: ev.queries,
              sparqlMs: ev.ms,
            }))
            setStage('통합 답변·정합성 판정 생성 중…')
          } else if (ev.stage === 'merged') {
            setR((p) => ({ ...p, merged: ev.answer }))
          } else if (ev.stage === 'verdict') {
            setR((p) => ({ ...p, verdicts: ev.verdicts, summary: ev.summary }))
          } else if (ev.stage === 'error') {
            setR((p) => ({ ...p, error: ev.error }))
          }
        }
      }
    } catch (e) {
      setR((p) => ({ ...p, error: (e as Error).message }))
    } finally {
      setBusy(false)
      setStage('')
    }
  }

  const sourceIds = r?.answers?.map((a) => a.id) ?? []

  return (
    <>
      <div className="tabbar">
        <div className="tab on">
          <Scale size={14} aria-hidden />
          <span className="name">정합성 검증</span>
        </div>
        <span className="center">같은 질문을 RAG API와 SPARQL 직조회로 비교합니다</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div style={{ maxWidth: 1040, padding: '28px 32px 64px' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={input}
              placeholder="검증할 질문을 입력하세요"
              aria-label="검증할 질문"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run(input)}
              style={{ flex: 1, height: 34 }}
            />
            <button className="primary" disabled={busy || !input.trim()} onClick={() => run(input)}>
              <Play size={13} aria-hidden style={{ marginRight: 5 }} />
              {busy ? '검증 중…' : '검증'}
            </button>
          </div>

          {!r && (
            <div className="chip-row" style={{ marginTop: 14 }}>
              {EXAMPLES.map((ex) => (
                <button key={ex} className="chip" onClick={() => run(ex)}>
                  {ex}
                </button>
              ))}
            </div>
          )}

          {stage && (
            <p className="meta" style={{ marginTop: 16 }} aria-live="polite">
              {stage}
            </p>
          )}
          {r?.error && (
            <p className="notice" style={{ marginTop: 16 }}>
              {r.error}
            </p>
          )}

          {r?.terms && (
            <p className="meta" style={{ marginTop: 16 }}>
              SPARQL 검색어: {r.terms.join(' · ')}
              {r.counts &&
                ` — 개체 ${r.counts.nodes} · 관계 ${r.counts.edges} · 본문 매치 ${r.counts.textHits}${
                  r.sparqlMs ? ` (${Math.round(r.sparqlMs / 1000)}초)` : ''
                }`}
            </p>
          )}

          {r?.merged && (
            <div
              style={{
                marginTop: 20,
                padding: '14px 16px',
                background: 'var(--panel)',
                borderRadius: 8,
                fontSize: 13.5,
                lineHeight: 1.55,
                color: 'var(--text-body)',
                whiteSpace: 'pre-wrap',
              }}
            >
              <strong style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>
                통합 답변 (API 3소스 종합)
              </strong>
              {r.merged}
            </div>
          )}

          {r?.summary && (
            <div
              style={{
                marginTop: 20,
                padding: '14px 16px',
                background: 'var(--panel)',
                borderRadius: 8,
                fontSize: 14,
                color: 'var(--text-body)',
              }}
            >
              <strong style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>종합 판정</strong>
              {r.summary}
            </div>
          )}

          {sourceIds.map((id) => {
            const a = r?.answers?.find((x) => x.id === id)
            const d = r?.digests?.find((x) => x.id === id)
            const v = r?.verdicts?.find((x) => x.source === id)
            return (
              <section key={id} style={{ marginTop: 32 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 650 }}>{a?.name ?? id}</h3>
                  {v && <VerdictBadge verdict={v.verdict} />}
                </div>
                {v && (
                  <p style={{ margin: '6px 0 12px', fontSize: 13, color: 'var(--text-dim)' }}>{v.reason}</p>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ background: 'var(--panel)', borderRadius: 8, padding: '12px 14px', minWidth: 0 }}>
                    <p className="meta" style={{ marginBottom: 8 }}>
                      A. RAG API 답변 {a && `(${Math.round(a.ms / 1000)}초)`}
                    </p>
                    <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: 'var(--text-body)', maxHeight: 360, overflowY: 'auto' }}>
                      {a?.ok ? a.answer : <span className="notice">실패 — {a?.error}</span>}
                    </div>
                  </div>
                  <div style={{ background: 'var(--panel)', borderRadius: 8, padding: '12px 14px', minWidth: 0 }}>
                    <p className="meta" style={{ marginBottom: 8 }}>
                      B. SPARQL 직조회
                    </p>
                    <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: 'var(--text-body)', maxHeight: 360, overflowY: 'auto' }}>
                      {d?.text ?? '(없음)'}
                    </div>
                  </div>
                </div>
              </section>
            )
          })}

          {r?.queries && r.queries.length > 0 && (
            <details style={{ marginTop: 28 }}>
              <summary className="meta" style={{ cursor: 'pointer' }}>
                실행된 SPARQL 질의 {r.queries.filter((q) => q.kind !== 'api').length}건
              </summary>
              {r.queries
                .filter((q) => q.kind !== 'api')
                .map((q, i) => (
                  <pre
                    key={i}
                    style={{
                      marginTop: 10,
                      padding: '10px 12px',
                      background: 'var(--panel)',
                      borderRadius: 8,
                      fontSize: 12,
                      overflowX: 'auto',
                    }}
                  >
                    {`# ${q.source} · ${q.kind} · "${q.term}"\n${q.sparql}`}
                  </pre>
                ))}
            </details>
          )}
        </div>
      </div>
    </>
  )
}
