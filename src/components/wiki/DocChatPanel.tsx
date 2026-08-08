'use client'
import { useRef, useState } from 'react'
import { MessageSquareText, Send, X } from 'lucide-react'
import { Markdown } from '@/components/wiki/Markdown'
import { useEntityTypes } from '@/components/wiki/useEntityTypes'
import { streamChat } from '@/lib/chat/stream'

type Msg = { role: 'user' | 'assistant'; content: string }

/**
 * 문서 사이드 챗 — 현재 문서 본문을 컨텍스트로 질문한다.
 * 대화는 저장하지 않는다(ephemeral). 문서가 바뀌면 부모가 key={slug}로 갈아 끼워
 * 대화가 통째로 초기화된다.
 */
export function DocChatPanel({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const entityTypes = useEntityTypes()

  const scrollDown = () =>
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    })

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || busy) return
    setInput('')
    const history: Msg[] = [...messages, { role: 'user', content: q }]
    setMessages([...history, { role: 'assistant', content: '' }])
    setBusy(true)
    scrollDown()
    try {
      const { text: answer } = await streamChat(
        { messages: history, docSlug: slug, ephemeral: true },
        (acc) => {
          setMessages([...history, { role: 'assistant', content: acc }])
          scrollDown()
        },
      )
      if (!answer) setMessages([...history, { role: 'assistant', content: '(빈 응답)' }])
    } catch (e) {
      setMessages([...history, { role: 'assistant', content: (e as Error).message }])
    } finally {
      setBusy(false)
      scrollDown()
    }
  }

  return (
    <aside className="doc-chat" aria-label="문서에 질문">
      <div className="head">
        <MessageSquareText size={14} aria-hidden />
        문서에 질문
        <span className="grow" />
        <button className="icon" aria-label="닫기" onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      <div className="doc-chat-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <p className="meta" style={{ padding: '8px 2px' }}>
            이 문서 내용에 대해 물어보세요. 대화는 저장되지 않습니다.
          </p>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="msg-user">
              {m.content}
            </div>
          ) : (
            <div key={i} className="msg-ai">
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

      <div className="composer" style={{ padding: '10px 12px' }}>
        <div className="composer-box">
          <textarea
            rows={1}
            value={input}
            placeholder="문서에 대해 질문..."
            aria-label="문서 질문 입력"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(input)
              }
            }}
          />
          <button className="send" aria-label="전송" disabled={busy || !input.trim()} onClick={() => send(input)}>
            <Send size={15} aria-hidden />
          </button>
        </div>
      </div>
    </aside>
  )
}
