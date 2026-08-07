'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

type Run = { id: string; status: string; resultSlug: string | null; startedAt: string }
type Flow = {
  id: string
  title: string
  enabled: boolean
  scheduleWeekday: number
  scheduleHour: number
  nextRunAt: string | null
  runs: Run[]
}

type CalItem = { kind: 'run-done' | 'run-error' | 'planned'; label: string; href?: string }

const pad = (n: number) => String(n).padStart(2, '0')
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/**
 * 캘린더 — FLOW 실행 이력(완료/실패)과 예정 실행을 월간 그리드로 보여준다.
 * 예정은 "매주 X요일" 규칙을 이번 달 날짜에 펼쳐서 표시한다.
 */
export default function CalendarPage() {
  const [flows, setFlows] = useState<Flow[]>([])
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  useEffect(() => {
    fetch('/api/flow')
      .then((r) => r.json())
      .then((b) => setFlows(b.flows ?? []))
      .catch(() => {})
  }, [])

  const { cells, monthLabel } = useMemo(() => {
    const year = cursor.getFullYear()
    const month = cursor.getMonth()
    const first = new Date(year, month, 1)
    const start = new Date(first)
    start.setDate(1 - first.getDay()) // 일요일 시작

    const byDate = new Map<string, CalItem[]>()
    const put = (key: string, item: CalItem) => {
      const list = byDate.get(key) ?? []
      list.push(item)
      byDate.set(key, list)
    }

    for (const f of flows) {
      for (const r of f.runs) {
        const key = dateKey(new Date(r.startedAt))
        if (r.status === 'done') {
          put(key, { kind: 'run-done', label: f.title, href: r.resultSlug ? `/wiki/${r.resultSlug}` : undefined })
        } else if (r.status === 'error') {
          put(key, { kind: 'run-error', label: `${f.title} 실패` })
        }
      }
      // 예정: 이번 달의 해당 요일마다 표시 (오늘 이후만)
      if (f.enabled) {
        const today = new Date()
        for (let d = new Date(year, month, 1); d.getMonth() === month; d.setDate(d.getDate() + 1)) {
          if (d.getDay() === f.scheduleWeekday && d >= new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
            put(dateKey(d), { kind: 'planned', label: `${f.title} (${f.scheduleHour}시 예정)` })
          }
        }
      }
    }

    const cells = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      return {
        date: d,
        inMonth: d.getMonth() === month,
        isToday: dateKey(d) === dateKey(new Date()),
        items: byDate.get(dateKey(d)) ?? [],
      }
    })
    return { cells, monthLabel: `${year}년 ${month + 1}월` }
  }, [flows, cursor])

  const move = (delta: number) =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1))

  return (
    <>
      <div className="tabbar">
        <div className="tab on">
          <CalendarDays size={14} aria-hidden />
          <span className="name">캘린더</span>
        </div>
        <span className="center">FLOW 실행 이력과 예정을 보여줍니다</span>
      </div>

      <div className="doc">
        <div className="doc-inner" style={{ maxWidth: 1100 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <h1 className="doc-title" style={{ fontSize: 24, margin: 0, flex: 1 }}>{monthLabel}</h1>
            <button className="icon" aria-label="이전 달" onClick={() => move(-1)}>
              <ChevronLeft size={15} />
            </button>
            <button className="icon" aria-label="다음 달" onClick={() => move(1)}>
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="cal-grid">
            {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
              <div key={d} className="cal-head">
                {d}
              </div>
            ))}
            {cells.map((c, i) => (
              <div key={i} className={`cal-cell${c.inMonth ? '' : ' out'}${c.isToday ? ' today' : ''}`}>
                <span className="d">{c.date.getDate()}</span>
                {c.items.map((it, j) =>
                  it.href ? (
                    <a key={j} className={`cal-item ${it.kind}`} href={it.href}>
                      {it.label}
                    </a>
                  ) : (
                    <span key={j} className={`cal-item ${it.kind}`}>
                      {it.label}
                    </span>
                  ),
                )}
              </div>
            ))}
          </div>
          <p className="meta" style={{ marginTop: 10 }}>
            완료 항목을 누르면 생성된 문서로 이동합니다. 등록·수정은 FLOW 메뉴에서.
          </p>
        </div>
      </div>
    </>
  )
}
