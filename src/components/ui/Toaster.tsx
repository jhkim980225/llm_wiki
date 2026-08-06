'use client'
import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { TOAST_EVENT, type ToastType } from '@/lib/toast'

type Item = { id: number; message: string; type: ToastType }

const LIFETIME_MS = 3500
const MAX_VISIBLE = 3

const ICON = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
} as const

/** 우상단 토스트 스택. layout.tsx가 body에 한 번 장착한다. */
export function Toaster() {
  const [items, setItems] = useState<Item[]>([])

  useEffect(() => {
    let seq = 0
    const onToast = (e: Event) => {
      const { message, type } = (e as CustomEvent<{ message: string; type: ToastType }>).detail
      const id = ++seq
      setItems((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), { id, message, type }])
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), LIFETIME_MS)
    }
    window.addEventListener(TOAST_EVENT, onToast)
    return () => window.removeEventListener(TOAST_EVENT, onToast)
  }, [])

  if (items.length === 0) return null

  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((t) => {
        const Icon = ICON[t.type]
        return (
          <div key={t.id} className={`toast ${t.type}`}>
            <Icon size={15} aria-hidden />
            {t.message}
          </div>
        )
      })}
    </div>
  )
}
