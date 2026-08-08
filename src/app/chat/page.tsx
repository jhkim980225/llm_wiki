'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Send, Plus, Trash2, Menu } from 'lucide-react'
import { Markdown } from '@/components/wiki/Markdown'
import { useEntityTypes } from '@/components/wiki/useEntityTypes'
import { streamChat } from '@/lib/chat/stream'

type Msg = { role: 'user' | 'assistant'; content: string }
type Conv = { id: string; title: string; updatedAt: string }

const EXAMPLES = [
  '회사 구성원에 대해 알려줘',
  '거래처에 보낼 발주 확인 메일 초안을 써줘',
  '이 워크스페이스로 뭘 할 수 있어?',
]

export default function ChatPage() {
  const [convs, setConvs] = useState<Conv[]>([])
  const [convId, setConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [convOpen, setConvOpen] = useState(false) // 모바일 대화목록 드로어
  const entityTypes = useEntityTypes()
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
    setConvOpen(false)
  }

  const openConv = async (id: string) => {
    if (busy) return
    const res = await fetch(`/api/chat/conversations/${id}`)
    if (!res.ok) return
    setConvId(id)
    setMessages((await res.json()).messages ?? [])
    setConvOpen(false)
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
      const { text, conversationId } = await streamChat(
        { messages: history, conversationId: convId },
        (acc) => {
          setMessages((m) => patchLast(m, acc))
          scrollDown()
        },
      )
      if (conversationId && conversationId !== convId) setConvId(conversationId)
      if (!text) setMessages((m) => patchLast(m, '(빈 응답)'))
      loadConvs() // 목록 최신화(새 대화 제목·정렬)
    } catch (e) {
      setMessages((m) => patchLast(m, (e as Error).message || '서버에 연결할 수 없습니다.'))
    } finally {
      setBusy(false)
      scrollDown()
    }
  }

  return (
    <>
      <div className="tabbar">
        <button
          className="chat-convs-toggle"
          aria-label="대화 목록 열기"
          onClick={() => setConvOpen((v) => !v)}
        >
          <Menu size={16} aria-hidden />
        </button>
        <div className="tab on">
          <MessageSquare size={14} aria-hidden />
          <span className="name">채팅</span>
        </div>
        <span className="center">사내 데이터 검색·템플릿 문서 작성까지 — 기존 문서는 고치지 않아요</span>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
        {/* 모바일 드로어 백드롭 */}
        <div
          className={convOpen ? 'chat-backdrop open' : 'chat-backdrop'}
          onClick={() => setConvOpen(false)}
          aria-hidden
        />

        {/* 대화 목록 */}
        <aside className={convOpen ? 'chat-convs open' : 'chat-convs'}>
          <button className="chat-new" onClick={newChat}>
            <Plus size={14} aria-hidden /> 새 대화
          </button>
          <div className="conv-list">
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
              >
                <MessageSquare size={13} aria-hidden className="ic" />
                <span className="t">{c.title}</span>
                <button
                  onClick={(e) => removeConv(c.id, e)}
                  aria-label="대화 삭제"
                  title="삭제"
                  className="del"
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
                    <div className="body">
                      {m.content ? (
                        <Markdown content={m.content} entityTypes={entityTypes} preview />
                      ) : busy && i === messages.length - 1 ? (
                        <span className="meta">생각하는 중…</span>
                      ) : null}
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
