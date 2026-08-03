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
    <main className="shell">
      <section className="rise" style={{ padding: '2.5rem 0 1.5rem' }}>
        <p className="eyebrow">온톨로지 소스</p>
        <h1>바깥 지식을 문서로 들인다</h1>
        <p style={{ color: 'var(--text-dim)', maxWidth: '36rem', lineHeight: 1.8 }}>
          Fuseki의 개체를 위키 문서로 만들고, 개체 사이의 관계를 <code>[[링크]]</code>로 적는다.
          그래프로 그리는 대신 문서끼리 걸어 두는 방식이라, 어느 문서에서 시작해도 이웃으로
          걸어갈 수 있다. 사람이 손댄 문서는 다시 적재해도 덮어쓰지 않는다.
        </p>
      </section>

      <section className="stack">
        {sources.map((s) => {
          const r = results[s.id]
          return (
            <div key={s.id} className="rise glass" style={{ padding: '1.1rem 1.3rem' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ margin: 0 }}>{s.name}</h3>
                  <span className="meta">
                    {s.url}/{s.dataset}
                  </span>
                </div>
                <div className="row">
                  <span className="chip">문서 {s.pages.toLocaleString('ko-KR')}</span>
                  <button className="primary" onClick={() => run(s.id)} disabled={busy !== null}>
                    {busy === s.id ? '가져오는 중…' : '가져오기'}
                  </button>
                </div>
              </div>

              {r && (
                <p className="meta" style={{ marginTop: '0.8rem' }}>
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
    </main>
  )
}
