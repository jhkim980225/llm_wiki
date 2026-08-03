'use client'
import { useState } from 'react'
import { useChat } from '@ai-sdk/react'

/** 툴 호출 파트는 `tool-<이름>` 타입으로 온다. 어떤 툴이 돌았는지만 보여준다. */
const toolLabel = (type: string) => type.replace(/^tool-/, '')

export function ChatPanel() {
  const { messages, sendMessage, status } = useChat()
  const [input, setInput] = useState('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    sendMessage({ text })
    setInput('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', maxWidth: 760, padding: 16 }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {messages.map((m) => (
          <div key={m.id} style={{ margin: '12px 0' }}>
            <strong>{m.role === 'user' ? '나' : '위키 도우미'}</strong>
            {m.parts.map((part, i) => {
              if (part.type === 'text') {
                return (
                  <p key={i} style={{ whiteSpace: 'pre-wrap', margin: '4px 0' }}>
                    {part.text}
                  </p>
                )
              }
              if (part.type.startsWith('tool-')) {
                return (
                  <div key={i} style={{ color: '#5f6368', fontSize: 12, margin: '4px 0' }}>
                    🔧 {toolLabel(part.type)}
                  </div>
                )
              }
              return null
            })}
          </div>
        ))}
        {status === 'submitted' && <p style={{ color: '#5f6368' }}>생각 중…</p>}
      </div>

      <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="예: Acme 페이지 만들고 RAG 문서와 이어줘"
          style={{ flex: 1, padding: 8 }}
        />
        <button type="submit" disabled={status !== 'ready'}>
          보내기
        </button>
      </form>
    </div>
  )
}
