'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    })
    setBusy(false)
    if (res.ok) router.replace('/')
    else setErr('비밀번호가 올바르지 않습니다.')
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#0f1115',
        color: '#e5e7eb',
        fontFamily: 'Pretendard Variable, Pretendard, system-ui, sans-serif',
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: 320,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 28,
          border: '1px solid #262a33',
          borderRadius: 12,
          background: '#151820',
        }}
      >
        <h1 style={{ fontSize: 18, margin: 0, fontWeight: 600 }}>주식회사 성진</h1>
        <p style={{ margin: '0 0 4px', fontSize: 13, color: '#9ca3af' }}>
          접근하려면 비밀번호를 입력하세요.
        </p>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
          placeholder="비밀번호"
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid #2b303b',
            background: '#0f1115',
            color: '#e5e7eb',
            fontSize: 14,
          }}
        />
        {err && <span style={{ color: '#f87171', fontSize: 13 }}>{err}</span>}
        <button
          type="submit"
          disabled={busy || !pw}
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            border: 'none',
            background: '#2DD4BF',
            color: '#04201c',
            fontWeight: 600,
            fontSize: 14,
            cursor: busy || !pw ? 'default' : 'pointer',
            opacity: busy || !pw ? 0.6 : 1,
          }}
        >
          {busy ? '확인 중…' : '입장'}
        </button>
      </form>
    </main>
  )
}
