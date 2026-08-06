'use client'
import { useCallback, useEffect, useState } from 'react'
import { LogOut, X } from 'lucide-react'
import { toast } from '@/lib/toast'

type GraphSource = {
  id: string
  name: string
  endpoint: string
  ok: boolean
  hasData: boolean
  latencyMs: number
  error?: string
}
type Graphs = { connected: number; withData: number; total: number; latencyMs: number; sources: GraphSource[] }
type Llm = { backend: string; baseURL: string; model: string; ok: boolean; modelAvailable?: boolean; latencyMs?: number; error?: string }
type Ontology = { sources: { id: string; name: string; pages: number }[] }

type Tab = 'status' | 'about'

export function Settings({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('status')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings">
        <nav className="settings-tabs">
          <strong>설정</strong>
          <button className={tab === 'status' ? 'on' : ''} onClick={() => setTab('status')}>
            상태
          </button>
          <button className={tab === 'about' ? 'on' : ''} onClick={() => setTab('about')}>
            정보
          </button>
          <span className="grow" />
          <button
            className="icon"
            aria-label="로그아웃"
            title="로그아웃"
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
              toast('로그아웃했습니다.', 'success')
              // 라우터 대신 전체 리로드 — 클라이언트 상태를 확실히 비운다
              window.location.href = '/login'
            }}
          >
            <LogOut size={15} />
          </button>
          <button className="icon" aria-label="닫기" title="닫기" onClick={onClose}>
            <X size={15} />
          </button>
        </nav>
        <div className="settings-body">{tab === 'status' ? <StatusTab /> : <AboutTab />}</div>
      </div>
    </div>
  )
}

type ImportResult = {
  source: string
  entities: number
  triples: number
  created: number
  updated: number
  skipped: number
  ms: number
  error?: string
}

function StatusTab() {
  const [graphs, setGraphs] = useState<Graphs | null>(null)
  const [llm, setLlm] = useState<Llm | null>(null)
  const [ontology, setOntology] = useState<Ontology | null>(null)
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)

  // 그래프 확인은 죽은 소스를 기다리느라 오래 걸린다. 빠른 것부터 따로 채운다.
  const load = useCallback(() => {
    setBusy(true)
    setGraphs(null)
    fetch('/api/llm').then((r) => r.json()).then(setLlm).catch(() => setLlm(null))
    fetch('/api/ontology').then((r) => r.json()).then(setOntology).catch(() => setOntology(null))
    fetch('/api/graphs')
      .then((r) => r.json())
      .then(setGraphs)
      .catch(() => setGraphs(null))
      .finally(() => setBusy(false))
  }, [])

  useEffect(load, [load])

  const loaded = ontology?.sources ?? []
  const pagesOf = (id: string) => loaded.find((s) => s.id === id)?.pages ?? 0

  // 온톨로지 가져오기 — 구 /sources 화면 기능. 개체→문서, 관계→[[링크]].
  // 사람이 손댄 문서는 서버가 건너뛴다.
  const runImport = async (id: string, name: string) => {
    setImporting(id)
    try {
      const res = await fetch('/api/ontology', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: id, limit: 40000 }),
      })
      const r: ImportResult = await res.json()
      if (!res.ok || r.error) {
        toast(`${name} 가져오기 실패: ${r.error ?? `HTTP ${res.status}`}`, 'error')
      } else {
        toast(
          `${name}: 개체 ${r.entities.toLocaleString('ko-KR')} · 새 문서 ${r.created.toLocaleString('ko-KR')} · 갱신 ${r.updated.toLocaleString('ko-KR')} · 건너뜀 ${r.skipped} · ${(r.ms / 1000).toFixed(1)}초`,
          'success',
        )
      }
      load()
      window.dispatchEvent(new Event('wiki:refresh'))
    } catch {
      toast(`${name} 가져오기 실패: 서버에 연결할 수 없습니다.`, 'error')
    } finally {
      setImporting(null)
    }
  }

  return (
    <>
      <div className="settings-head">
        <h4>지식 그래프</h4>
        <span className="meta">
          {graphs ? `연결 ${graphs.connected}/${graphs.total} · 데이터 ${graphs.withData}/${graphs.total}` : busy ? '확인 중…' : '—'}
        </span>
        <button className="quiet" onClick={load} disabled={busy}>
          {busy ? '확인 중…' : '다시 확인'}
        </button>
      </div>

      {/* 죽은 엔드포인트는 TCP가 끊길 때까지 기다려서 10초 넘게 걸린다. */}
      {!graphs && busy && <p className="meta">그래프에 붙어 보는 중… 죽은 소스가 있으면 10초쯤 걸립니다.</p>}

      {graphs && (
        <table className="status">
          <tbody>
            {graphs.sources.map((s) => (
              <tr key={s.id}>
                <td className={s.ok ? 'dot ok' : 'dot bad'}>●</td>
                <td>
                  <span className="t">{s.name}</span>
                  <span className="meta">{s.endpoint}</span>
                  {s.error && <span className="notice">{s.error}</span>}
                </td>
                <td className="num">
                  {s.ok ? (s.hasData ? '데이터 있음' : '비어 있음') : '실패'}
                  <span className="meta">{s.latencyMs}ms</span>
                </td>
                <td className="num">
                  {pagesOf(s.id) > 0 ? `${pagesOf(s.id).toLocaleString('ko-KR')}건 적재됨` : '미적재'}
                </td>
                <td className="num">
                  <button
                    className="quiet"
                    disabled={importing !== null || !s.ok}
                    title={s.ok ? '개체를 문서로 가져온다' : '연결 실패 — 가져올 수 없음'}
                    onClick={() => runImport(s.id, s.name)}
                  >
                    {importing === s.id ? '가져오는 중…' : '가져오기'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="settings-head">
        <h4>LLM</h4>
      </div>
      {llm ? (
        <table className="status">
          <tbody>
            <tr>
              <td className={llm.ok ? 'dot ok' : 'dot bad'}>●</td>
              <td>
                <span className="t">{llm.model}</span>
                <span className="meta">
                  {llm.backend} · {llm.baseURL}
                </span>
                {llm.error && <span className="notice">{llm.error}</span>}
              </td>
              <td className="num">
                {llm.ok ? (llm.modelAvailable ? '모델 있음' : '모델 없음') : '실패'}
                <span className="meta">{llm.latencyMs ?? '—'}ms</span>
              </td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="meta">확인 중…</p>
      )}
    </>
  )
}

function AboutTab() {
  return (
    <div className="prose" style={{ fontSize: 13 }}>
      <p>
        사내 Fuseki 온톨로지를 위키 문서로 들여와 옵시디언처럼 <code>[[링크]]</code>로 오가며
        읽고 고치는 앱.
      </p>
      <ul>
        <li>
          <strong>상태</strong> 탭이 지금 어느 그래프에 붙는지 보여준다. 실패는 &ldquo;사실이
          없다&rdquo;가 아니라 &ldquo;물어보지 못했다&rdquo;이다.
        </li>
        <li>
          한 번 실패한 소스는 60초간 건너뛴다. <em>다시 확인</em>을 누르면 차단을 무시하고
          실제로 찔러 본다.
        </li>
        <li>
          <code>Ctrl+K</code> 검색 · <code>/ask</code> AI 작성 · 온톨로지 가져오기는 상태 탭의
          소스별 <em>가져오기</em> 버튼
        </li>
      </ul>
    </div>
  )
}
