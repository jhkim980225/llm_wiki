'use client'
import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  MoreHorizontal,
  Paperclip,
  RotateCcw,
  Send,
  Share2,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { Button, IconButton } from '@/components/ui'
import { normalizeSlug } from '@/lib/wiki/slug'

type SourceStatus = { id: string; name: string; ok: boolean; searchedText?: boolean; error?: string }
type Draft = { title: string; summary: string; content: string }
type WikiHit = { slug: string; title: string }
type Graph = { sources: SourceStatus[]; nodes: unknown[]; textHits: unknown[] }

/** 대화 한 칸. AI 메시지는 스트리밍 중 text가 자라고, 완료되면 draft가 붙는다. */
type Msg =
  | { role: 'user'; text: string; time: string }
  | {
      role: 'ai'
      text: string
      streaming: boolean
      draft?: Draft
      wiki?: WikiHit[]
      graph?: Graph
      terms?: string[]
      saved?: string | null
      error?: string
    }

const EXAMPLES = [
  '글리세롤이 들어간 제품과 관련 문서를 정리해줘',
  '주식회사 성진과 주고받은 문서를 정리해줘',
]

/** 추출된 용어로 만드는 후속 질문. LLM을 더 부르지 않는 결정적 추천이다. */
function suggestions(terms: string[] | undefined): string[] {
  const t = terms?.[0]
  if (!t) return []
  return [`${t} 시장 규모와 전망을 정리해줘`, `${t}의 안전성과 규제 정보를 알려줘`, `${t} 대체 성분과 비교해줘`]
}

const now = () =>
  new Date().toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })

export default function AskPage() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 새 내용이 흘러올 때 바닥을 따라간다
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const patchLastAi = (patch: Partial<Extract<Msg, { role: 'ai' }>>) =>
    setMessages((ms) => {
      const next = [...ms]
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'ai') {
          next[i] = { ...(next[i] as Extract<Msg, { role: 'ai' }>), ...patch }
          break
        }
      }
      return next
    })

  const save = async (draft: Draft) => {
    const post = (slug: string) =>
      fetch('/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          title: draft.title,
          summary: draft.summary,
          content: draft.content,
          pageType: 'synthesis',
          editSource: 'agent',
        }),
      })
    let slug = normalizeSlug(draft.title)
    let res = await post(slug)
    if (res.status === 409) {
      // 같은 이름이 살아 있으면 덮지 않고 접미사로 비켜 저장한다
      slug = `${slug}-${Date.now().toString(36)}`
      res = await post(slug)
    }
    patchLastAi(res.ok ? { saved: slug } : { saved: null })
  }

  const ask = async (q: string) => {
    const text = q.trim()
    if (!text || busy) return
    setBusy(true)
    setInput('')
    setMessages((ms) => [
      ...ms,
      { role: 'user', text, time: now() },
      { role: 'ai', text: '', streaming: true },
    ])

    try {
      const res = await fetch('/api/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: text }),
      })
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}))
        patchLastAi({ streaming: false, error: body.error ?? `HTTP ${res.status}` })
        return
      }

      // NDJSON — 한 줄에 이벤트 하나. 줄이 잘려 올 수 있어 버퍼에 모았다 자른다.
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
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
          if (ev.stage === 'terms') patchLastAi({ terms: ev.terms })
          else if (ev.stage === 'graph') patchLastAi({ graph: ev.graph, wiki: ev.wiki ?? [] })
          else if (ev.stage === 'delta') {
            acc += ev.text
            patchLastAi({ text: acc })
          } else if (ev.stage === 'done') {
            patchLastAi({ streaming: false, text: '', draft: ev.draft })
            void save(ev.draft)
          } else if (ev.stage === 'error') patchLastAi({ streaming: false, error: ev.error })
        }
      }
    } catch (e) {
      patchLastAi({ streaming: false, error: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const lastAi = [...messages].reverse().find((m): m is Extract<Msg, { role: 'ai' }> => m.role === 'ai')

  return (
    <>
      <div className="tabbar">
        <div className="tab on">
          <span className="name">자연어로 문서 만들기</span>
        </div>
        <span className="center">그래프로 SPARQL로 조회해 문서를 씁니다</span>
        <span className="side">
          <Button size="sm" onClick={() => setMessages([])} disabled={busy || messages.length === 0}>
            <RotateCcw size={13} aria-hidden /> 새 대화
          </Button>
          <IconButton label="더보기">
            <MoreHorizontal size={15} />
          </IconButton>
        </span>
      </div>

      <div className="chat-wrap">
        <div className="chat-scroll" ref={scrollRef}>
          <div className="chat-inner">
            {messages.length === 0 && (
              <div style={{ paddingTop: 32 }}>
                <p className="meta" style={{ marginBottom: 10 }}>
                  무엇을 정리할까요? 그래프 3개와 위키 문서를 함께 뒤져 출처가 남는 문서를 만듭니다.
                </p>
                <div className="chip-row">
                  {EXAMPLES.map((ex) => (
                    <button key={ex} className="chip" onClick={() => ask(ex)}>
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="msg-user">
                  {m.text}
                  <span className="stamp">
                    {m.time} <span aria-label="전송 완료">✓</span>
                  </span>
                </div>
              ) : (
                <AiMessage key={i} msg={m} onAsk={ask} onSave={save} />
              ),
            )}
          </div>
        </div>

        {panel && lastAi?.graph && (
          <ContextPanel graph={lastAi.graph} wiki={lastAi.wiki ?? []} onClose={() => setPanel(false)} />
        )}

        <div className="composer">
          <div className="composer-box">
            <IconButton label="첨부 (준비 중)" disabled>
              <Paperclip size={15} />
            </IconButton>
            <textarea
              rows={1}
              value={input}
              placeholder="문서를 만들고 싶은 내용을 입력하세요..."
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  ask(input)
                }
              }}
            />
            <IconButton label="옵션 (준비 중)" disabled>
              <SlidersHorizontal size={15} />
            </IconButton>
            <button className="send" aria-label="전송" disabled={busy || !input.trim()} onClick={() => ask(input)}>
              <Send size={15} />
            </button>
          </div>
          <p className="hint">Enter로 전송, Shift+Enter로 줄바꿈</p>
        </div>
      </div>
    </>
  )
}

function AiMessage({
  msg,
  onAsk,
  onSave,
}: {
  msg: Extract<Msg, { role: 'ai' }>
  onAsk: (q: string) => void
  onSave: (d: Draft) => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="msg-ai">
      <span className="ai-icon">
        <Share2 size={15} aria-hidden />
      </span>
      <div className="body">
        {msg.error && <p className="notice">{msg.error}</p>}

        {msg.streaming && !msg.text && <p className="meta">그래프와 위키를 조회하는 중…</p>}

        {/* 스트리밍 중에는 흘러오는 마크다운을 그대로 보여준다 — 빈 화면 4분 방지 */}
        {msg.streaming && msg.text && (
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', margin: 0 }}>
            {msg.text}
          </pre>
        )}

        {msg.draft && (
          <>
            <p style={{ margin: '0 0 4px' }}>
              요청하신 내용을 바탕으로 &lsquo;{msg.draft.title}&rsquo;를 정리했습니다. 아래는 문서의 개요입니다.
            </p>
            <div className="doc-card">
              <div className="doc-card-head">
                <FileText size={15} aria-hidden style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                <span className="t">{msg.draft.title}</span>
                <span className="badge-draft">초안</span>
                {msg.saved ? (
                  <a className="btn" style={{ height: 28, fontSize: 12.5 }} href={`/wiki/${msg.saved}`}>
                    <ExternalLink size={13} aria-hidden /> 저장됨 · 열기
                  </a>
                ) : msg.saved === null ? (
                  <Button size="sm" variant="primary" onClick={() => onSave(msg.draft!)}>
                    문서로 저장
                  </Button>
                ) : (
                  <span className="meta">저장 중…</span>
                )}
              </div>
              <div
                className={`doc-card-body prose${expanded ? '' : ' clamped'}`}
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(msg.draft.content) as string) }}
              />
              <div className="doc-card-foot">
                <button className="quiet" onClick={() => setExpanded((v) => !v)}>
                  {expanded ? (
                    <>
                      접기 <ChevronUp size={13} aria-hidden />
                    </>
                  ) : (
                    <>
                      더보기 <ChevronDown size={13} aria-hidden />
                    </>
                  )}
                </button>
              </div>
            </div>

            {(msg.wiki?.length ?? 0) > 0 && (
              <div className="chip-row">
                <span className="lbl">출처</span>
                {msg.wiki!.slice(0, 3).map((w) => (
                  <a key={w.slug} className="chip" href={`/wiki/${w.slug}`}>
                    <FileText size={12} aria-hidden /> {w.title}
                  </a>
                ))}
                {msg.wiki!.length > 3 && <span className="chip">+{msg.wiki!.length - 3}개 더보기</span>}
              </div>
            )}

            {suggestions(msg.terms).length > 0 && (
              <div className="chip-row">
                <span className="lbl">추천 프롬프트</span>
                {suggestions(msg.terms).map((s) => (
                  <button key={s} className="chip" onClick={() => onAsk(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ContextPanel({
  graph,
  wiki,
  onClose,
}: {
  graph: Graph
  wiki: WikiHit[]
  onClose: () => void
}) {
  const [tab, setTab] = useState<'docs' | 'graph'>('docs')

  return (
    <aside className="ctx-panel">
      <div className="ctx-head">
        관련 문서 &amp; 그래프 컨텍스트
        <span style={{ flex: 1 }} />
        <IconButton label="닫기" onClick={onClose}>
          <X size={13} />
        </IconButton>
      </div>
      <div className="ctx-tabs">
        <button className={tab === 'docs' ? 'on' : ''} onClick={() => setTab('docs')}>
          관련 문서
        </button>
        <button className={tab === 'graph' ? 'on' : ''} onClick={() => setTab('graph')}>
          그래프 컨텍스트
        </button>
      </div>
      <div className="ctx-body">
        {tab === 'docs' ? (
          wiki.length > 0 ? (
            wiki.map((w) => (
              <a key={w.slug} href={`/wiki/${w.slug}`}>
                <FileText size={13} aria-hidden /> {w.title}
              </a>
            ))
          ) : (
            <span className="meta">근거로 쓴 위키 문서 없음</span>
          )
        ) : (
          <>
            {graph.sources.map((s) => (
              <div key={s.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ color: s.ok ? 'var(--accent)' : 'var(--danger)', fontSize: 9 }}>●</span>
                <span style={{ color: 'var(--text-dim)' }}>{s.name}</span>
                {s.searchedText && <span className="meta">본문검색</span>}
              </div>
            ))}
            <span className="meta">
              개체 {graph.nodes.length}건 · 본문 매치 {graph.textHits.length}건
            </span>
          </>
        )}
      </div>
    </aside>
  )
}
