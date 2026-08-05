'use client'
import { useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { normalizeSlug } from '@/lib/wiki/slug'

type SourceStatus = { id: string; name: string; ok: boolean; searchedText?: boolean; error?: string }
type Draft = { title: string; summary: string; content: string }
type WikiHit = { slug: string; title: string }
type Result = {
  terms: string[]
  graph: { sources: SourceStatus[]; nodes: unknown[]; textHits: unknown[] }
  evidence: { source: string; label: string }[]
  wiki: WikiHit[]
  draft: Draft
}

const EXAMPLES = [
  '글리세롤이 들어간 제품과 관련 문서를 정리해줘',
  '주식회사 성진과 주고받은 문서를 정리해줘',
]

export default function AskPage() {
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [streamed, setStreamed] = useState('')
  const [stage, setStage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const ask = async (q: string) => {
    const text = q.trim()
    if (!text) return
    setBusy(true)
    setError(null)
    setResult(null)
    setStreamed('')
    setStage('용어를 뽑는 중…')
    setSaved(null)

    try {
      const res = await fetch('/api/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: text }),
      })
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }

      // NDJSON — 한 줄에 이벤트 하나. 줄이 잘려 올 수 있어 버퍼에 모았다 자른다.
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let terms: string[] = []
      let graph: Result['graph'] | null = null
      let evidence: Result['evidence'] = []
      let wiki: WikiHit[] = []
      let acc = ''

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
            terms = ev.terms
            setStage(`"${terms.join('", "')}" 로 그래프를 조회하는 중…`)
          } else if (ev.stage === 'graph') {
            graph = ev.graph
            evidence = ev.evidence
            wiki = ev.wiki ?? []
            const ok = ev.graph.sources.filter((x: SourceStatus) => x.ok).length
            setStage(`그래프 ${ok}/${ev.graph.sources.length} · 위키 ${wiki.length}건 조회 완료 · 문서를 쓰는 중…`)
          } else if (ev.stage === 'delta') {
            acc += ev.text
            setStreamed(acc)
          } else if (ev.stage === 'done') {
            setResult({ terms, graph: graph!, evidence, wiki, draft: ev.draft })
            setStage(null)
            // 완성되면 바로 볼트에 저장한다. 실패하면 수동 저장 버튼이 남는다.
            void save(ev.draft)
          } else if (ev.stage === 'error') {
            setError(ev.error)
          }
        }
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      setStage(null)
    }
  }

  const save = async (draft?: Draft) => {
    const d = draft ?? result?.draft
    if (!d) return
    setSaving(true)
    setError(null)
    try {
      const post = (slug: string) =>
        fetch('/api/pages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug,
            title: d.title,
            summary: d.summary,
            content: d.content,
            pageType: 'synthesis',
            editSource: 'agent',
          }),
        })

      let slug = normalizeSlug(d.title)
      let res = await post(slug)
      if (res.status === 409) {
        // 같은 이름 문서가 살아 있으면 덮어쓰지 않고 접미사로 비켜 저장한다
        slug = `${slug}-${Date.now().toString(36)}`
        res = await post(slug)
      }
      if (res.ok) {
        setSaved(slug)
        return
      }
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? `HTTP ${res.status}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="tabbar">
        <div className="tab on">
          <span className="name">자연어로 문서 만들기</span>
        </div>
        <span className="center">그래프를 SPARQL로 조회해 문서를 씁니다</span>
      </div>

      <div className="doc">
        <div className="doc-inner">
          <div style={{ display: 'grid', gap: 8, maxWidth: 760 }}>
            <textarea
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              rows={3}
              placeholder="무엇을 정리할까요? 예: 글리세롤이 들어간 제품과 관련 문서를 정리해줘"
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') ask(request)
              }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="primary" onClick={() => ask(request)} disabled={busy || !request.trim()}>
                {busy ? '찾는 중…' : '문서 만들기'}
              </button>
              <span className="meta">Ctrl+Enter</span>
              <span className="grow" style={{ flex: 1 }} />
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  className="quiet"
                  disabled={busy}
                  onClick={() => {
                    setRequest(ex)
                    ask(ex)
                  }}
                >
                  {ex.slice(0, 18)}…
                </button>
              ))}
            </div>
            {error && <p className="notice">{error}</p>}
          </div>

          {stage && (
            <p className="meta" style={{ marginTop: 20 }}>
              {stage}
            </p>
          )}

          {/* 다 쓰기 전까지는 흘러오는 글자를 그대로 보여준다. 몇 분을 빈 화면으로
              기다리게 하지 않으려는 것이라 마크다운 렌더는 완성 후에 한다. */}
          {!result && streamed && (
            <pre
              style={{
                marginTop: 16,
                maxWidth: 760,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'inherit',
                fontSize: 14,
                lineHeight: 1.75,
              }}
            >
              {streamed}
            </pre>
          )}

          {result && <Draft result={result} onSave={save} saving={saving} saved={saved} />}
        </div>
      </div>
    </>
  )
}

function Draft({
  result,
  onSave,
  saving,
  saved,
}: {
  result: Result
  onSave: () => void
  saving: boolean
  saved: string | null
}) {
  const html = DOMPurify.sanitize(marked.parse(result.draft.content) as string)

  return (
    <div style={{ marginTop: 24, maxWidth: 760 }}>
      <div className="props">
        <div className="props-title">이 문서를 만든 근거</div>
        <div className="prop-row">
          <span className="prop-key">검색어</span>
          <span className="prop-val">
            {result.terms.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </span>
        </div>
        <div className="prop-row">
          <span className="prop-key">그래프</span>
          <span className="prop-val">
            {result.graph.sources.map((s) => (
              <span key={s.id} className="tag" title={s.error ?? ''}>
                {s.ok ? '● ' : '○ '}
                {s.name}
                {s.searchedText ? ' (본문검색)' : ''}
              </span>
            ))}
          </span>
        </div>
        <div className="prop-row">
          <span className="prop-key">근거</span>
          <span className="prop-val">
            개체 {result.evidence.length}건 · 관계 {result.graph.nodes.length}건 · 본문
            {' '}
            {result.graph.textHits.length}건 · 위키 문서 {result.wiki.length}건
          </span>
        </div>
        {result.wiki.length > 0 && (
          <div className="prop-row">
            <span className="prop-key">위키 근거</span>
            <span className="prop-val">
              {result.wiki.map((w) => (
                <a key={w.slug} className="tag" href={`/wiki/${w.slug}`}>
                  {w.title}
                </a>
              ))}
            </span>
          </div>
        )}
      </div>

      {result.graph.sources.some((s) => !s.ok) && (
        <p className="notice">
          조회하지 못한 그래프가 있습니다. 빠진 내용은 &ldquo;사실이 없다&rdquo;가 아니라
          &ldquo;확인하지 못했다&rdquo;입니다.
        </p>
      )}

      <h1 style={{ fontSize: '1.8rem', margin: '18px 0 4px' }}>{result.draft.title}</h1>
      <p className="meta">{result.draft.summary}</p>

      <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 20 }}>
        {saved ? (
          <>
            <span className="meta">저장했습니다.</span>
            <a className="btn" href={`/wiki/${saved}`}>
              문서 열기
            </a>
          </>
        ) : (
          <button className="primary" onClick={onSave} disabled={saving}>
            {saving ? '저장 중…' : '볼트에 저장'}
          </button>
        )}
      </div>
    </div>
  )
}
