'use client'
import { useEffect, useState } from 'react'
import { useChat } from '@ai-sdk/react'

/** 툴 호출 파트는 `tool-<이름>` 타입으로 온다. 어떤 툴이 돌았는지만 보여준다. */
const toolLabel = (type: string) => type.replace(/^tool-/, '')

type LlmHealth = {
  backend: string
  model: string
  ok: boolean
  modelAvailable?: boolean
  latencyMs?: number
  error?: string
}

export function ChatPanel() {
  const { messages, sendMessage, status } = useChat({
    // 도우미가 문서를 만들거나 지웠을 수 있다 — 턴이 끝나면 트리에 갱신을 알린다
    onFinish: () => window.dispatchEvent(new Event('wiki:refresh')),
  })
  const [input, setInput] = useState('')
  const [llm, setLlm] = useState<LlmHealth | null>(null)

  // 백엔드가 죽었으면 답 없는 입력창을 붙들고 있지 않게 미리 알려준다.
  useEffect(() => {
    fetch('/api/llm')
      .then((r) => r.json())
      .then(setLlm)
      .catch(() => setLlm(null))
  }, [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    sendMessage({ text })
    setInput('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: 720, margin: '0 auto', width: '100%', padding: '0 20px 16px' }}>
      <div style={{ flex: 1, overflowY: 'auto', paddingTop: '1.2rem' }}>
        {llm && (
          <div style={{ justifyContent: 'flex-end' }}>
            <span
              className="meta"
              title={llm.error ?? `${llm.backend} · ${llm.model}`}
              style={{ color: llm.ok ? 'var(--ok)' : 'var(--danger)' }}
            >
              {llm.ok ? '●' : '○'} {llm.backend} · {llm.model}
              {llm.ok && llm.modelAvailable === false ? ' · 모델 없음' : ''}
              {!llm.ok ? ' · 연결 안 됨' : ''}
            </span>
          </div>
        )}

        {messages.length === 0 && (
          <div style={{ paddingTop: 24 }}>
            <p className="meta">위키 도우미</p>
            <h2 style={{ margin: '8px 0' }}>무엇을 적어둘까요?</h2>
            <p style={{ color: 'var(--text-dim)', lineHeight: 1.8, maxWidth: '30rem' }}>
              문서를 찾고, 쓰고, 이름을 바꾸고, 링크를 잇습니다. 지식 그래프에 개체 관계도 물어볼 수
              있습니다. 도우미가 쓴 문서는 편집 이력에 <span className="tag">⌬ 에이전트</span>로
              남습니다.
            </p>
          </div>
        )}

        {messages.map((m) => {
          const mine = m.role === 'user'
          return (
            <div
              key={m.id}
             
              style={{
                margin: '1rem 0',
                display: 'flex',
                justifyContent: mine ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  maxWidth: mine ? '80%' : '100%',
                  padding: mine ? '8px 12px' : 0,
                  background: mine ? 'var(--bg-hover)' : undefined,
                  borderRadius: 6,
                }}
              >
                {!mine && <span className="meta">위키 도우미</span>}
                {m.parts.map((part, i) => {
                  if (part.type === 'text') {
                    return (
                      <p
                        key={i}
                        style={{
                          whiteSpace: 'pre-wrap',
                          margin: '0.3rem 0',
                          lineHeight: 1.75,
                        }}
                      >
                        {part.text}
                      </p>
                    )
                  }
                  if (part.type.startsWith('tool-')) {
                    return (
                      <div key={i} style={{ margin: '0.4rem 0' }}>
                        <span className="tag" style={{ color: 'var(--accent)' }}>
                          ⌬ {toolLabel(part.type)}
                        </span>
                      </div>
                    )
                  }
                  return null
                })}
              </div>
            </div>
          )
        })}

        {status === 'submitted' && (
          <p className="meta">
            생각 중…
          </p>
        )}
      </div>

      <form onSubmit={submit} style={{ display: 'flex', gap: 8, border: '1px solid var(--line)', borderRadius: 6, padding: 6 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="예: Acme 페이지 만들고 RAG 문서와 이어줘"
          style={{ flex: 1, background: 'transparent', border: 0, boxShadow: 'none' }}
        />
        <button type="submit" className="primary" disabled={status !== 'ready'}>
          보내기
        </button>
      </form>
    </div>
  )
}
