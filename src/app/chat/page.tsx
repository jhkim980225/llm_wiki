'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Send, Plus, Trash2 } from 'lucide-react'

type Msg = { role: 'user' | 'assistant'; content: string }
type Conv = { id: string; title: string; updatedAt: string }

const EXAMPLES = [
  '전산회계 2급 시험 범위를 요약해줘',
  '부가가치세 신고 절차를 단계별로 알려줘',
  '이 워크스페이스로 뭘 할 수 있어?',
]

export default function ChatPage() {
  const [convs, setConvs] = useState<Conv[]>([])
  const [convId, setConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const scrollDown = () =>
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    })

  const loadConvs = async () => {
    const res = await fetch('/api/chat/conversations')
    if (res.ok) setConvs((await res.json()).conversations ?? [])
  }

  useEffect(() => {
    loadConvs()
  }, [])

  const newChat = () => {
    setConvId(null)
    setMessages([])
    setInput('')
  }

  const openConv = async (id: string) => {
    if (busy) return
    const res = await fetch(`/api/chat/conversations/${id}`)
    if (!res.ok) return
    setConvId(id)
    setMessages((await res.json()).messages ?? [])
    scrollDown()
  }

  const removeConv = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('이 대화를 삭제할까요?')) return
    const res = await fetch(`/api/chat/conversations/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setConvs((c) => c.filter((x) => x.id !== id))
      if (convId === id) newChat()
    }
  }

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || busy) return
    setInput('')

    const history: Msg[] = [...messages, { role: 'user', content: q }]
    setMessages([...history, { role: 'assistant', content: '' }])
    setBusy(true)
    scrollDown()

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, conversationId: convId }),
      })
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}))
        setMessages((m) => patchLast(m, err.error ?? `요청 실패 (HTTP ${res.status})`))
        return
      }
      const newId = res.headers.get('X-Conversation-Id')
      if (newId && newId !== convId) setConvId(newId)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        setMessages((m) => patchLast(m, acc))
        scrollDown()
      }
      if (!acc) setMessages((m) => patchLast(m, '(빈 응답)'))
      loadConvs() // 목록 최신화(새 대화 제목·정렬)
    } catch {
      setMessages((m) => patchLast(m, '서버에 연결할 수 없습니다.'))
    } finally {
      setBusy(false)
      scrollDown()
    }
  }

  return (
    <>
      <div className="tabbar">
        <div className="tab on">
          <MessageSquare size={14} aria-hidden />
          <span className="name">채팅</span>
        </div>
        <span className="center">위키를 건드리지 않는 일반 대화입니다</span>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* 대화 목록 */}
        <aside
          style={{
            width: 232,
            flexShrink: 0,
            borderRight: '1px solid var(--line)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <button
            onClick={newChat}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              margin: 12,
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: 'var(--panel)',
              color: 'var(--text)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            <Plus size={14} aria-hidden /> 새 대화
          </button>
          <div style={{ overflowY: 'auto', minHeight: 0, padding: '0 8px 8px' }}>
            {convs.length === 0 && (
              <p className="meta" style={{ padding: '4px 8px' }}>
                저장된 대화가 없습니다.
              </p>
            )}
            {convs.map((c) => (
              <div
                key={c.id}
                onClick={() => openConv(c.id)}
                className={c.id === convId ? 'conv-item on' : 'conv-item'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 10px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: c.id === convId ? 'var(--hover)' : 'transparent',
                  fontSize: 13,
                  color: 'var(--text-body)',
                }}
              >
                <MessageSquare size={13} aria-hidden style={{ flexShrink: 0, opacity: 0.6 }} />
                <span
                  style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {c.title}
                </span>
                <button
                  onClick={(e) => removeConv(c.id, e)}
                  aria-label="대화 삭제"
                  title="삭제"
                  style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: 2 }}
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* 채팅 영역 */}
        <div className="chat-wrap">
          <div className="chat-scroll" ref={scrollRef}>
            <div className="chat-inner">
              {messages.length === 0 && (
                <div style={{ paddingTop: 32 }}>
                  <p className="meta" style={{ marginBottom: 10 }}>
                    무엇이든 물어보세요.
                  </p>
                  <div className="chip-row">
                    {EXAMPLES.map((ex) => (
                      <button key={ex} className="chip" onClick={() => send(ex)}>
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="msg-user">
                    {m.content}
                  </div>
                ) : (
                  <div key={i} className="msg-ai">
                    <span className="ai-icon">
                      <MessageSquare size={15} aria-hidden />
                    </span>
                    <div className="body" style={{ whiteSpace: 'pre-wrap' }}>
                      {m.content ||
                        (busy && i === messages.length - 1 ? (
                          <span className="meta">생각하는 중…</span>
                        ) : null)}
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>

          <div className="composer">
            <div className="composer-box">
              <textarea
                rows={1}
                value={input}
                placeholder="메시지를 입력하세요..."
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send(input)
                  }
                }}
              />
              <button
                className="send"
                aria-label="전송"
                disabled={busy || !input.trim()}
                onClick={() => send(input)}
              >
                <Send size={16} aria-hidden />
              </button>
            </div>
            <p className="hint">Enter로 전송, Shift+Enter로 줄바꿈</p>
          </div>
        </div>
      </div>
    </>
  )
}

/** 마지막(assistant) 메시지의 content를 교체한다. */
function patchLast(messages: Msg[], content: string): Msg[] {
  if (messages.length === 0) return messages
  const copy = messages.slice()
  copy[copy.length - 1] = { ...copy[copy.length - 1], content }
  return copy
}
