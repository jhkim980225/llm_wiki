'use client'
import { useCallback, useEffect, useState } from 'react'

type Source = { id: string; name: string; url: string; dataset: string; pages: number }
type Result = {
  source: string
  entities: number
  triples: number
  created: number
  updated: number
  skipped: number
  ms: number
  error?: string
}

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, Result>>({})

  const load = useCallback(() => {
    fetch('/api/ontology')
      .then((r) => r.json())
      .then((b) => setSources(b.sources ?? []))
      .catch(() => setSources([]))
  }, [])

  useEffect(load, [load])

  const run = async (id: string) => {
    setBusy(id)
    try {
      const res = await fetch('/api/ontology', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: id, limit: 40000 }),
      })
      const body: Result = await res.json()
      setResults((r) => ({ ...r, [id]: body }))
      load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="tabbar">
        <div className="tab"><span className="name">소스</span></div>
        <span className="center">온톨로지 가져오기</span>
      </div>
      <div className="doc"><div className="doc-inner">
        <p style={{ color: 'var(--text-dim)', fontSize: 13.5, marginTop: 0 }}>
          Fuseki 개체를 문서로 만들고 관계를 <code>[[링크]]</code>로 적는다.
          사람이 손댄 문서는 덮어쓰지 않는다.
        </p>
      <section>
        {sources.map((s) => {
          const r = results[s.id]
          return (
            <div key={s.id} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '12px 14px', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <strong>{s.name}</strong>
                  <div className="meta">{s.url}/{s.dataset}</div>
                </div>
                <span className="meta">문서 {s.pages.toLocaleString('ko-KR')}</span>
                <button className="primary" onClick={() => run(s.id)} disabled={busy !== null}>
                  {busy === s.id ? '가져오는 중…' : '가져오기'}
                </button>
              </div>

              {r && (
                <p className="meta" style={{ marginTop: 8 }}>
                  {r.error ? (
                    <span className="notice">{r.error}</span>
                  ) : (
                    <>
                      개체 {r.entities.toLocaleString('ko-KR')} · 트리플{' '}
                      {r.triples.toLocaleString('ko-KR')} · 새 문서 {r.created.toLocaleString('ko-KR')}{' '}
                      · 갱신 {r.updated.toLocaleString('ko-KR')} · 사람이 손대 건너뜀 {r.skipped} ·{' '}
                      {(r.ms / 1000).toFixed(1)}초
                    </>
                  )}
                </p>
              )}
            </div>
          )
        })}
        {sources.length === 0 && <p className="meta">등록된 소스가 없습니다.</p>}
      </section>
      </div></div>
    </>
  )
}
