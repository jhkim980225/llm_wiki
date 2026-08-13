'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarRange, ExternalLink, Play, Plus, Trash2, Workflow, X } from 'lucide-react'
import { toast } from '@/lib/toast'

type Run = {
  id: string
  status: string
  trigger: string
  resultSlug: string | null
  error: string | null
  startedAt: string
}
type Flow = {
  id: string
  title: string
  prompt: string
  templateSlug: string
  targetFolderName: string | null
  scheduleWeekday: number
  scheduleHour: number
  enabled: boolean
  lastRunAt: string | null
  nextRunAt: string | null
  runs: Run[]
}
type TemplateDoc = { slug: string; title: string }

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

/**
 * FLOW — 프롬프트+템플릿+저장폴더를 등록해 두고 주 1회 자동 실행하는 배치 작업 화면.
 * 실행 결과 문서는 지정 폴더에 쌓이고, 일정은 캘린더 화면에 반영된다.
 */
export default function FlowPage() {
  const [flows, setFlows] = useState<Flow[]>([])
  const [templates, setTemplates] = useState<TemplateDoc[]>([])
  const [folders, setFolders] = useState<string[]>([])
  // 실행 결과를 누르면 어떤 지시문으로 만들어진 문서인지 먼저 보여 준다 —
  // 목록만으로는 "이 문서가 왜 이렇게 나왔나"를 알 수 없다.
  const [detail, setDetail] = useState<{ flow: Flow; run: Run } | null>(null)
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null) // 실행 중인 flow id
  const [form, setForm] = useState({
    title: '',
    prompt: '',
    templateSlug: '',
    targetFolderName: '',
    scheduleWeekday: 1,
    scheduleHour: 9,
  })

  const load = async () => {
    const res = await fetch('/api/flow')
    if (res.ok) setFlows((await res.json()).flows ?? [])
  }

  // 템플릿 후보 — '템플릿' 폴더 안 문서들. 폴더가 없으면 빈 목록(직접 입력).
  // 저장 폴더 후보도 같은 응답에서 얻는다 — 오타로 새 폴더가 생기는 것을 막는다.
  const loadTemplates = async () => {
    try {
      const folders = (await (await fetch('/api/folders')).json()).items as { id: string; name: string }[]
      setFolders([...new Set(folders.map((f) => f.name))])
      const tpl = folders.find((f) => f.name === '템플릿')
      if (!tpl) return
      // tree API의 파라미터는 folderId다 — parentId로 불렀더니 루트 문서가
      // 드롭다운에 나왔다(실측). 같은 이유로 빈 목록이면 직접 입력으로 남긴다.
      const tree = await (await fetch(`/api/tree?folderId=${tpl.id}`)).json()
      setTemplates((tree.pages ?? []).map((p: TemplateDoc) => ({ slug: p.slug, title: p.title })))
    } catch {
      /* 후보 없이 직접 입력으로 동작 */
    }
  }

  useEffect(() => {
    load()
    loadTemplates()
  }, [])

  const create = async (runAfter = false) => {
    if (!form.title.trim() || !form.prompt.trim() || !form.templateSlug.trim()) {
      toast('제목·프롬프트·템플릿은 필수입니다.', 'error')
      return
    }
    const res = await fetch('/api/flow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        targetFolderName: form.targetFolderName.trim() || undefined,
      }),
    })
    if (!res.ok) {
      toast((await res.json()).error ?? '등록에 실패했습니다.', 'error')
      return
    }
    const flow = await res.json()
    toast('FLOW를 등록했습니다. 캘린더에 반영됩니다.', 'success')
    setForm({ title: '', prompt: '', templateSlug: '', targetFolderName: '', scheduleWeekday: 1, scheduleHour: 9 })
    await load()
    // 테스트용 즉시 실행 — 스케줄을 기다리지 않고 결과를 바로 확인한다.
    if (runAfter && flow?.id) await runNow(flow.id)
  }

  const runNow = async (id: string) => {
    setBusy(id)
    toast('실행 중 — 문서 작성까지 2~4분 걸립니다.', 'info')
    try {
      const res = await fetch(`/api/flow/${id}/run`, { method: 'POST' })
      const body = await res.json()
      if (res.ok) toast(`완료: ${body.resultSlug}`, 'success')
      else toast(`실패: ${body.error ?? res.status}`, 'error')
    } finally {
      setBusy(null)
      load()
    }
  }

  const toggle = async (f: Flow) => {
    await fetch(`/api/flow/${f.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !f.enabled }),
    })
    load()
  }

  const remove = async (id: string) => {
    if (!confirm('이 FLOW를 삭제할까요? 실행 이력도 함께 지워집니다.')) return
    await fetch(`/api/flow/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <>
      <div className="tabbar">
        <div className="tab on">
          <Workflow size={14} aria-hidden />
          <span className="name">FLOW</span>
        </div>
        <span className="center">템플릿 기반 문서 작성을 등록해 두면 주 1회 자동 실행됩니다</span>
      </div>

      <div className="doc">
        <div className="doc-inner">
          <h1 className="doc-title" style={{ fontSize: 24 }}>FLOW 등록</h1>
          <div className="flow-form">
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="작업 이름 (예: 주간업무내역 작성)"
              aria-label="작업 이름"
            />
            <textarea
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              rows={3}
              placeholder="지시문 (예: 템플릿 양식대로 이번 주 주간업무내역을 작성해줘)"
              aria-label="지시문"
            />
            <div className="row">
              {templates.length > 0 ? (
                <select
                  value={form.templateSlug}
                  onChange={(e) => setForm({ ...form, templateSlug: e.target.value })}
                  aria-label="템플릿 문서"
                >
                  <option value="">템플릿 문서 선택</option>
                  {templates.map((t) => (
                    <option key={t.slug} value={t.slug}>
                      {t.title}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={form.templateSlug}
                  onChange={(e) => setForm({ ...form, templateSlug: e.target.value })}
                  placeholder="템플릿 문서 slug (예: 주간업무내역-양식)"
                  aria-label="템플릿 문서 slug"
                />
              )}
              {/* 폴더는 고르게 한다 — 직접 입력이면 오타 하나가 새 폴더를 만든다
                  (resolveFolder가 없는 이름을 만들어 준다). 목록을 못 받으면 입력으로 남긴다. */}
              {folders.length > 0 ? (
                <select
                  value={form.targetFolderName}
                  onChange={(e) => setForm({ ...form, targetFolderName: e.target.value })}
                  aria-label="저장 폴더"
                >
                  <option value="">저장 폴더 선택 (미지정 시 최상위)</option>
                  {folders.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={form.targetFolderName}
                  onChange={(e) => setForm({ ...form, targetFolderName: e.target.value })}
                  placeholder="저장 폴더 이름 (예: 주간업무)"
                  aria-label="저장 폴더"
                />
              )}
            </div>
            <div className="row">
              <label className="meta">매주</label>
              <select
                value={form.scheduleWeekday}
                onChange={(e) => setForm({ ...form, scheduleWeekday: Number(e.target.value) })}
                aria-label="요일"
              >
                {WEEKDAYS.map((d, i) => (
                  <option key={i} value={i}>
                    {d}요일
                  </option>
                ))}
              </select>
              <select
                value={form.scheduleHour}
                onChange={(e) => setForm({ ...form, scheduleHour: Number(e.target.value) })}
                aria-label="시각"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {h}시
                  </option>
                ))}
              </select>
              <span className="grow" />
              <button className="quiet" onClick={() => create(true)} disabled={busy !== null}>
                <Play size={13} aria-hidden /> 등록 + 즉시 실행
              </button>
              <button className="primary" onClick={() => create()}>
                <Plus size={14} aria-hidden /> 등록
              </button>
            </div>
          </div>

          <h2 style={{ fontSize: 18, margin: '32px 0 12px' }}>등록된 FLOW</h2>
          {flows.length === 0 && <p className="meta">등록된 작업이 없습니다.</p>}
          {flows.map((f) => (
            <div key={f.id} className="flow-card">
              <div className="head">
                <strong>{f.title}</strong>
                <span className="meta">
                  매주 {WEEKDAYS[f.scheduleWeekday]}요일 {f.scheduleHour}시 · 다음 실행 {fmt(f.nextRunAt)}
                </span>
                <span className="grow" />
                <button
                  className={f.enabled ? 'badge' : 'badge draft'}
                  onClick={() => toggle(f)}
                  title="클릭해서 켜기/끄기"
                >
                  ● {f.enabled ? '활성' : '중지'}
                </button>
                <button className="quiet" onClick={() => runNow(f.id)} disabled={busy !== null}>
                  <Play size={13} aria-hidden /> {busy === f.id ? '실행 중…' : '지금 실행'}
                </button>
                <button className="icon" aria-label="삭제" onClick={() => remove(f.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
              <p className="meta" style={{ margin: '4px 0 8px' }}>
                템플릿 {f.templateSlug} → {f.targetFolderName ?? '(폴더 미지정)'} 저장
              </p>
              {f.runs.length > 0 && (
                <div className="runs">
                  {f.runs.map((r) => (
                    <span key={r.id} className={`run ${r.status}`}>
                      <CalendarRange size={11} aria-hidden /> {fmt(r.startedAt)}{' '}
                      {r.status === 'done' && r.resultSlug ? (
                        <button className="link" onClick={() => setDetail({ flow: f, run: r })}>
                          {r.resultSlug}
                        </button>
                      ) : r.status === 'error' ? (
                        `실패: ${(r.error ?? '').slice(0, 60)}`
                      ) : (
                        '실행 중'
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {detail && (
        <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="modal-card flow-detail">
            <div className="head">
              <h3 style={{ margin: 0 }}>{detail.flow.title}</h3>
              <span className="grow" />
              <button className="icon" aria-label="닫기" onClick={() => setDetail(null)}>
                <X size={14} />
              </button>
            </div>

            <dl className="attrs">
              <div>
                <dt>지시문</dt>
                <dd className="prompt">{detail.flow.prompt}</dd>
              </div>
              <div>
                <dt>템플릿</dt>
                <dd>{detail.flow.templateSlug}</dd>
              </div>
              <div>
                <dt>저장 폴더</dt>
                <dd>{detail.flow.targetFolderName ?? '(미지정 — 최상위)'}</dd>
              </div>
              <div>
                <dt>주기</dt>
                <dd>
                  매주 {WEEKDAYS[detail.flow.scheduleWeekday]}요일 {detail.flow.scheduleHour}시
                  {detail.flow.enabled ? '' : ' (중지됨)'}
                </dd>
              </div>
              <div>
                <dt>이 실행</dt>
                <dd>
                  {fmt(detail.run.startedAt)} · {detail.run.trigger === 'manual' ? '수동' : '스케줄'}
                </dd>
              </div>
              <div>
                <dt>결과 문서</dt>
                <dd className="uri">{detail.run.resultSlug}</dd>
              </div>
            </dl>

            <div className="buttons">
              <button className="quiet" onClick={() => setDetail(null)}>
                닫기
              </button>
              <button className="primary" onClick={() => router.push(`/wiki/${detail.run.resultSlug}`)}>
                <ExternalLink size={13} aria-hidden /> 문서로 가기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
