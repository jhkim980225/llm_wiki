'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  ExternalLink,
  FileText,
  Maximize,
  Minus,
  Plus,
  Sparkles,
  Waypoints,
} from 'lucide-react'
import type { GraphEdge, GraphNode, XY } from '@/lib/wiki/graph'
import { layoutGraph } from '@/lib/wiki/graph'
import { wikiHref } from '@/lib/wiki/href'

type GraphData = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  total: { nodes: number; edges: number }
}

type PageDetail = {
  slug: string
  title: string
  pageType: string
  summary: string
  outLinks: string[]
  deadLinks: string[]
  backlinks: { slug: string; title: string }[]
  backlinkTotal: number
  updatedAt: string
  version: number
  lastEditSource: string
}

const TYPE_LABEL: Record<string, string> = {
  concept: '개념 문서',
  entity: '온톨로지 개체',
  synthesis: 'AI 작성 문서',
}

const SOURCE_LABEL: Record<string, string> = {
  user: '사용자',
  agent: 'AI',
  revert: '되돌리기',
  ontology: '온톨로지 적재',
}

function NodeIcon({ type, size }: { type: string; size: number }) {
  const half = -size / 2
  const props = { x: half, y: half, width: size, height: size, strokeWidth: 1.6, 'aria-hidden': true }
  if (type === 'entity') return <BookOpen {...props} />
  if (type === 'synthesis') return <Sparkles {...props} />
  return <FileText {...props} />
}


const fmtDate = (iso: string) => iso.slice(0, 16).replace('T', ' ')

const radius = (degree: number) => 13 + Math.min(9, degree)

export function GraphView() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const [data, setData] = useState<GraphData | null>(null)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<PageDetail | null>(null)
  const [t, setT] = useState({ x: 0, y: 0, k: 1 })

  useEffect(() => {
    fetch('/api/graph')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true))
  }, [])

  const pos = useMemo<Record<string, XY>>(() => {
    if (!data) return {}
    // 배치 면적을 노드 수에 비례시켜 노드 간격을 일정하게 — 고정 면적이면
    // 문서 몇 개짜리 그래프가 황량하게 퍼진다
    const size = Math.max(500, Math.sqrt(data.nodes.length) * 150)
    return layoutGraph(data.nodes, data.edges, { width: size, height: size })
  }, [data])

  /** 노드 전체가 화면에 들어오는 transform. */
  const fit = () => {
    const el = wrapRef.current
    const pts = Object.values(pos)
    if (!el || pts.length === 0) return
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const pad = 80
    const bw = Math.max(...xs) - Math.min(...xs) + pad * 2
    const bh = Math.max(...ys) - Math.min(...ys) + pad * 2
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2
    const k = Math.min(el.clientWidth / bw, el.clientHeight / bh, 1.4)
    setT({ k, x: el.clientWidth / 2 - cx * k, y: el.clientHeight / 2 - cy * k })
  }

  // 데이터가 처음 오면 화면 맞춤
  const fitted = useRef(false)
  useEffect(() => {
    if (!fitted.current && Object.keys(pos).length) {
      fitted.current = true
      fit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos])

  // 휠 줌 — passive:false가 필요해서 직접 붙인다
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const f = Math.exp(-e.deltaY * 0.0012)
      setT((prev) => {
        const k = Math.min(3, Math.max(0.15, prev.k * f))
        const real = k / prev.k
        return { k, x: cx - (cx - prev.x) * real, y: cy - (cy - prev.y) * real }
      })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  // 배경 드래그 팬
  const drag = useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest('.gnode')) return
    drag.current = { x: e.clientX - t.x, y: e.clientY - t.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return
    setT((prev) => ({ ...prev, x: e.clientX - drag.current!.x, y: e.clientY - drag.current!.y }))
  }
  const onPointerUp = () => {
    drag.current = null
  }

  const zoom = (f: number) => {
    const el = wrapRef.current
    if (!el) return
    const cx = el.clientWidth / 2
    const cy = el.clientHeight / 2
    setT((prev) => {
      const k = Math.min(3, Math.max(0.15, prev.k * f))
      const real = k / prev.k
      return { k, x: cx - (cx - prev.x) * real, y: cy - (cy - prev.y) * real }
    })
  }

  // 선택 노드 상세
  useEffect(() => {
    if (!selected) {
      setDetail(null)
      return
    }
    let stale = false
    fetch('/api/pages/' + encodeURIComponent(selected))
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => !stale && setDetail(d))
      .catch(() => !stale && setDetail(null))
    return () => {
      stale = true
    }
  }, [selected])

  if (error)
    return (
      <div className="graph-page">
        <div className="graph-empty">그래프 데이터를 불러오지 못했습니다.</div>
      </div>
    )

  const liveOut = detail ? detail.outLinks.length - detail.deadLinks.length : 0

  return (
    <div className="graph-page">
      <div className="graph-canvas" ref={wrapRef}>
        <svg
          ref={svgRef}
          className="graph-svg"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={(e) => {
            if (!(e.target as Element).closest('.gnode')) setSelected(null)
          }}
          role="img"
          aria-label="문서 연결 그래프"
        >
          <g transform={`translate(${t.x} ${t.y}) scale(${t.k})`}>
            {data?.edges.map((e) => {
              const a = pos[e.source]
              const b = pos[e.target]
              if (!a || !b) return null
              const on = selected === e.source || selected === e.target
              return (
                <line
                  key={e.source + ' ' + e.target}
                  className={`gedge${on ? ' on' : ''}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                />
              )
            })}
            {data?.nodes.map((n) => {
              const p = pos[n.slug]
              if (!p) return null
              const r = radius(n.degree)
              return (
                <g
                  key={n.slug}
                  className={`gnode ${n.pageType}${selected === n.slug ? ' sel' : ''}`}
                  transform={`translate(${p.x} ${p.y})`}
                  onClick={() => setSelected(n.slug)}
                >
                  <circle r={r} />
                  <NodeIcon type={n.pageType} size={r >= 18 ? 18 : 14} />
                  <text y={r + 14}>{n.title}</text>
                </g>
              )
            })}
          </g>
        </svg>

        <div className="graph-toolbar">
          <span className="scope">
            {data && data.total.nodes > data.nodes.length
              ? `연결 상위 ${data.nodes.length.toLocaleString()}개`
              : '전체 그래프'}
          </span>
          {data && (
            <span className="meta">
              문서 {data.total.nodes.toLocaleString()} · 연결 {data.total.edges.toLocaleString()}
            </span>
          )}
        </div>

        <div className="graph-controls">
          <button onClick={() => zoom(1 / 1.25)} aria-label="축소">
            <Minus size={14} aria-hidden />
          </button>
          <span className="zoom">{Math.round(t.k * 100)}%</span>
          <button onClick={() => zoom(1.25)} aria-label="확대">
            <Plus size={14} aria-hidden />
          </button>
          <button onClick={fit} aria-label="화면 맞춤">
            <Maximize size={14} aria-hidden />
          </button>
        </div>

        {data && data.nodes.length === 0 && (
          <div className="graph-empty">
            <Waypoints size={20} aria-hidden />
            문서가 없습니다. 문서를 만들고 [[링크]]로 연결하면 그래프가 그려집니다.
          </div>
        )}
      </div>

      <aside className="graph-inspector" aria-label="노드 상세">
        {detail ? (
          <>
            <div className="head">
              <span className="ic">
                <NodeIcon type={detail.pageType} size={18} />
              </span>
              <div className="t">
                <h3>{detail.title}</h3>
                <div className="path">/{detail.slug}</div>
              </div>
            </div>

            <div className="sec">
              <span className="badge">{TYPE_LABEL[detail.pageType] ?? detail.pageType}</span>
            </div>

            <div className="sec stats">
              <div className="stat">
                나가는 링크<span className="v">{liveOut}</span>
              </div>
              <div className="stat">
                백링크<span className="v">{detail.backlinkTotal}</span>
              </div>
            </div>

            {detail.summary && (
              <div className="sec">
                <h4>요약</h4>
                <p className="summary">{detail.summary}</p>
              </div>
            )}

            <div className="sec meta-grid">
              <span className="k">수정일</span>
              <span className="v">{fmtDate(detail.updatedAt)}</span>
              <span className="k">버전</span>
              <span className="v">v{detail.version}</span>
              <span className="k">마지막 편집</span>
              <span className="v">{SOURCE_LABEL[detail.lastEditSource] ?? detail.lastEditSource}</span>
            </div>

            <div className="foot">
              <a className="open-btn" href={wikiHref(detail.slug)}>
                문서 열기
                <ExternalLink size={13} aria-hidden />
              </a>
            </div>
          </>
        ) : (
          <div className="placeholder">
            {selected ? '불러오는 중…' : '노드를 선택하면 상세 정보가 표시됩니다.'}
          </div>
        )}
      </aside>
    </div>
  )
}
