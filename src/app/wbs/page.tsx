'use client'

import { useEffect, useState } from 'react'
import { CalendarRange, Plus, Trash2, Sparkles, X } from 'lucide-react'
import { Markdown } from '@/components/wiki/Markdown'

type PlanRow = { id: string; title: string; updatedAt: string; _count: { tasks: number } }
type Entry = { id: string; date: string; summary: string; detail: string; status: string; source: string }
type Task = {
  id: string
  wbsCode: string | null
  title: string
  assignee: string | null
  startDate: string | null
  endDate: string | null
  durationDays: number | null
  entries: Entry[]
}
type Plan = { id: string; title: string; weekStart: string | null; tasks: Task[] }

const SAMPLE = `| WBS | 업무내용 | 담당자 | 시작일 | 종료일 | 기간(일) |
| --- | --- | --- | --- | --- | --- |
| 1.1 | Mobile-App 기능 및 테스트 | 태민 | 2026-04-15 | 2026-04-17 | 3 |
| 1.2 | 채널 연동 및 테스트 | 태민 | 2026-04-20 | 2026-04-22 | 3 |`

export default function WbsPage() {
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [plan, setPlan] = useState<Plan | null>(null)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newMd, setNewMd] = useState(SAMPLE)
  const [busy, setBusy] = useState(false)
  const [fillBusy, setFillBusy] = useState(false)
  const [fillJob, setFillJob] = useState<{ status: string; done: number; total: number } | null>(null)
  const [cell, setCell] = useState<{ task: Task; entry: Entry } | null>(null)
  const [err, setErr] = useState('')

  const loadPlans = async () => {
    const res = await fetch('/api/wbs')
    if (res.ok) setPlans((await res.json()).plans ?? [])
  }
  useEffect(() => {
    loadPlans()
  }, [])

  const openPlan = async (id: string) => {
    setCreating(false)
    setCell(null)
    setFillJob(null)
    const res = await fetch(`/api/wbs/${id}`)
    if (res.ok) setPlan((await res.json()).plan)
  }

  const createPlan = async () => {
    setBusy(true)
    setErr('')
    try {
      const res = await fetch('/api/wbs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle || '새 WBS', markdown: newMd }),
      })
      const body = await res.json()
      if (!res.ok) {
        setErr(body.error ?? `HTTP ${res.status}`)
        return
      }
      setNewTitle('')
      await loadPlans()
      await openPlan(body.id)
    } finally {
      setBusy(false)
    }
  }

  // 비동기 채우기 job을 폴링한다. running이면 2초마다 다시, 끝나면 플랜 새로고침.
  const pollFill = (id: string) => {
    const tick = async () => {
      const res = await fetch(`/api/wbs/${id}/fill`)
      if (!res.ok) {
        setFillBusy(false)
        return
      }
      const { job } = await res.json()
      if (!job) {
        setFillBusy(false)
        return
      }
      setFillJob({ status: job.status, done: job.done, total: job.total })
      if (job.status === 'running') {
        setTimeout(tick, 2000)
        return
      }
      if (job.status === 'error') setErr(job.error ?? '채우기 실패')
      setFillBusy(false)
      // 진행표시(done/total)는 유지한 채 결과만 새로고침
      const r = await fetch(`/api/wbs/${id}`)
      if (r.ok) setPlan((await r.json()).plan)
    }
    tick()
  }

  const fill = async () => {
    if (!plan) return
    setFillBusy(true)
    setErr('')
    setFillJob({ status: 'running', done: 0, total: 0 })
    const res = await fetch(`/api/wbs/${plan.id}/fill`, { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok && res.status !== 409) {
      setErr(body.error ?? `채우기 실패 (HTTP ${res.status})`)
      setFillBusy(false)
      return
    }
    pollFill(plan.id)
  }

  const removePlan = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('이 WBS를 삭제할까요?')) return
    const res = await fetch(`/api/wbs/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setPlans((p) => p.filter((x) => x.id !== id))
      if (plan?.id === id) setPlan(null)
    }
  }

  // 그리드용: 전 태스크의 날짜 합집합(정렬) + (taskId|date)→entry
  const dates = plan ? [...new Set(plan.tasks.flatMap((t) => t.entries.map((e) => e.date)))].sort() : []
  const entryAt = new Map<string, Entry>()
  plan?.tasks.forEach((t) => t.entries.forEach((e) => entryAt.set(`${t.id}|${e.date}`, e)))

  return (
    <>
      <div className="tabbar">
        <div className="tab on">
          <CalendarRange size={14} aria-hidden />
          <span className="name">WBS 일정</span>
        </div>
        <span className="center">WBS를 만들면 LLM이 주간 일정을 채웁니다 — 셀을 눌러 상세 확인</span>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* 플랜 목록 */}
        <aside className="chat-convs">
          <button className="chat-new" onClick={() => { setCreating(true); setPlan(null); setCell(null) }}>
            <Plus size={14} aria-hidden /> 새 WBS
          </button>
          <div className="conv-list">
            {plans.length === 0 && <p className="meta" style={{ padding: '4px 8px' }}>저장된 WBS가 없습니다.</p>}
            {plans.map((p) => (
              <div
                key={p.id}
                className={p.id === plan?.id ? 'conv-item on' : 'conv-item'}
                onClick={() => openPlan(p.id)}
              >
                <CalendarRange size={13} aria-hidden className="ic" />
                <span className="t">{p.title}</span>
                <span className="meta" style={{ fontSize: 11 }}>{p._count.tasks}</span>
                <button className="del" aria-label="삭제" onClick={(e) => removePlan(p.id, e)}>
                  <Trash2 size={13} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* 본문 */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 24 }}>
          {err && <p className="notice" style={{ marginBottom: 12 }}>{err}</p>}

          {creating ? (
            <div style={{ maxWidth: 760, display: 'grid', gap: 10 }}>
              <h2 style={{ margin: 0 }}>새 WBS</h2>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="제목 (예: 2026년 4월 앱 개발)"
                style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--text)' }}
              />
              <p className="meta">WBS 표를 마크다운으로 붙여넣으세요 (WBS·업무내용·담당자·시작일·종료일·기간 열).</p>
              <textarea
                value={newMd}
                onChange={(e) => setNewMd(e.target.value)}
                rows={12}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 13, padding: 12, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--text)' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="primary" onClick={createPlan} disabled={busy}>{busy ? '만드는 중…' : '만들기'}</button>
                <button className="quiet" onClick={() => setCreating(false)}>취소</button>
              </div>
            </div>
          ) : !plan ? (
            <p className="meta" style={{ paddingTop: 32 }}>왼쪽에서 WBS를 고르거나 "새 WBS"로 시작하세요.</p>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <h2 style={{ margin: 0 }}>{plan.title}</h2>
                <button className="primary" onClick={fill} disabled={fillBusy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Sparkles size={14} aria-hidden />
                  {fillBusy
                    ? fillJob && fillJob.total > 0
                      ? `채우는 중 ${fillJob.done}/${fillJob.total}`
                      : '채우는 중…'
                    : '주간일정 채우기'}
                </button>
                {fillJob && fillJob.status === 'done' && !fillBusy && (
                  <span className="meta">완료 · {fillJob.done}셀</span>
                )}
              </div>

              {/* 태스크 표 */}
              <table className="wbs-table">
                <thead>
                  <tr><th>WBS</th><th>업무내용</th><th>담당자</th><th>시작</th><th>종료</th><th>기간</th></tr>
                </thead>
                <tbody>
                  {plan.tasks.map((t) => (
                    <tr key={t.id}>
                      <td>{t.wbsCode}</td><td>{t.title}</td><td>{t.assignee}</td>
                      <td>{t.startDate}</td><td>{t.endDate}</td><td>{t.durationDays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* 일정 그리드 (태스크 × 날짜) */}
              {dates.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table className="wbs-grid">
                    <thead>
                      <tr>
                        <th style={{ position: 'sticky', left: 0 }}>업무 \ 날짜</th>
                        {dates.map((d) => <th key={d}>{d.slice(5)}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {plan.tasks.map((t) => (
                        <tr key={t.id}>
                          <td style={{ position: 'sticky', left: 0 }} title={t.title}>{t.title}</td>
                          {dates.map((d) => {
                            const e = entryAt.get(`${t.id}|${d}`)
                            return (
                              <td
                                key={d}
                                className={e ? 'cell filled' : 'cell'}
                                onClick={() => e && setCell({ task: t, entry: e })}
                                title={e?.summary}
                              >
                                {e ? e.summary : ''}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {dates.length === 0 && <p className="meta">아직 채워진 일정이 없습니다. "주간일정 채우기"를 눌러 LLM으로 채우세요.</p>}
            </div>
          )}
        </div>

        {/* 셀 상세 드로어 */}
        {cell && (
          <aside className="wbs-detail">
            <div className="head">
              <div>
                <div className="meta">{cell.entry.date} · {cell.task.title}</div>
                <strong>{cell.entry.summary}</strong>
              </div>
              <button className="del" aria-label="닫기" onClick={() => setCell(null)}><X size={16} aria-hidden /></button>
            </div>
            <div className="body prose">
              {cell.entry.detail ? <Markdown content={cell.entry.detail} /> : <p className="meta">상세 없음</p>}
            </div>
          </aside>
        )}
      </div>
    </>
  )
}
