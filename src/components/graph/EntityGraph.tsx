'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, ExternalLink, Maximize, Minus, Plus, Waypoints } from 'lucide-react'
import type { GraphEdge, GraphNode, XY } from '@/lib/wiki/graph'
import { layoutGraph } from '@/lib/wiki/graph'
import { normalizeSlug } from '@/lib/wiki/slug'

type EgoData = {
  center: string
  name: string
  type: string
  sourceId: string
  ambiguousCount: number
  nodes: GraphNode[]
  edges: GraphEdge[]
  neighborCount: number
  rels: { rel: string; count: number }[]
  types: { type: string; count: number }[]
}

/**
 * 온톨로지 클래스명 → 화면 표시명. 소스마다 어휘가 달라 아는 것만 옮기고
 * 모르는 값은 원문 그대로 둔다 (칩이 사라지는 것보다 영문이 낫다).
 */
const TYPE_LABEL: Record<string, string> = {
  Person: '인물',
  Organization: '조직',
  OrganizationCluster: '조직(묶음)',
  EmailMessage: '메일',
  Email: '메일',
  EmailThread: '메일 스레드',
  EmailAccount: '메일 계정',
  Document: '문서',
  BusinessCase: '업무 건',
  BusinessActivity: '업무 활동',
  JobTitle: '직함',
  Product: '제품',
  RawMaterial: '원료',
  AuxiliaryMaterial: '부자재',
  OrganizationRoleEvidence: '역할 근거',
  RelationshipAssertion: '관계 기술',
}

const typeLabel = (t: string) => TYPE_LABEL[t] ?? t

/** 선택한 이웃의 문서 미리보기 — 있으면 요약, 없으면 만들기 안내. */
type Preview =
  | { state: 'loading' }
  | { state: 'found'; title: string; summary: string; pageType: string }
  | { state: 'missing' }

/** slug의 각 경로 조각만 인코딩해 /wiki 경로를 만든다 (FileTree·GraphView와 같은 규칙). */
const wikiHref = (slug: string) => '/wiki/' + slug.split('/').map(encodeURIComponent).join('/')

const radius = (degree: number) => 13 + Math.min(9, degree)

/**
 * 개체 하나를 중심으로 한 1홉 관계 그래프.
 *
 * 문서 전체 그래프(GraphView)와 따로 두는 이유: 저쪽은 /api/graph 전량 조회와
 * Page.outLinks 전제에 묶여 있다. 여기는 그래프 DB를 직접 읽는다 — 갓 승격한 문서는
 * [[링크]]가 아직 없어 outLinks로 그리면 노드 하나만 뜬다.
 * 공유하는 것은 순수 레이아웃 함수 하나뿐이다.
 *
 * 관계 칩으로 한 관계만 골라 볼 수 있고(상한 50), 노드를 고르면 우측 패널에
 * 해당 문서 미리보기가 뜬다 — 문서 그래프(/graph)의 인스펙터와 같은 사용감.
 */
export function EntityGraph({ slug }: { slug: string }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const [data, setData] = useState<EgoData | null>(null)
  const [rel, setRel] = useState<string | null>(null)
  const [type, setType] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [t, setT] = useState({ x: 0, y: 0, k: 1 })

  useEffect(() => {
    let stale = false
    setData(null)
    setError('')
    setSelected(null)
    const q =
      (rel ? `&rel=${encodeURIComponent(rel)}` : '') +
      (type ? `&type=${encodeURIComponent(type)}` : '')
    fetch(`/api/graph-ref/graph?slug=${encodeURIComponent(slug)}${q}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error ?? '그래프를 불러오지 못했습니다.')
        return body as EgoData
      })
      .then((d) => !stale && setData(d))
      .catch((e: Error) => !stale && setError(e.message))
    return () => {
      stale = true
    }
  }, [slug, rel, type])

  // 문서를 옮기면 필터는 초기화한다 — 이전 개체의 관계·종류가 남아 있으면 빈 그래프가 된다.
  useEffect(() => {
    setRel(null)
    setType(null)
  }, [slug])

  const pos = useMemo<Record<string, XY>>(() => {
    if (!data) return {}
    const size = Math.max(420, Math.sqrt(data.nodes.length) * 150)
    return layoutGraph(data.nodes, data.edges, { width: size, height: size })
  }, [data])

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

  // 데이터가 올 때마다(필터 전환 포함) 화면 맞춤
  useEffect(() => {
    if (Object.keys(pos).length) fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos])

  // 휠 줌 — passive:false가 필요해서 직접 붙인다 (GraphView와 같은 이유)
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
  }, [data])

  const drag = useRef<{ x: number; y: number } | null>(null)

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

  const center = data?.nodes[0]
  const sel = data?.nodes.find((n) => n.slug === selected)
  const isCenter = sel && sel.slug === center?.slug
  // 이웃 문서 주소는 라벨로 만든다 — 적재본·승격본이 같은 규칙(entitySlug)을 쓰므로
  // 이미 있는 문서면 그대로 열리고, 없으면 문서 없음 화면이 받는다.
  const selSlug = sel && data && !isCenter ? `${data.sourceId}/${normalizeSlug(sel.title)}` : ''

  // 선택한 이웃의 문서 미리보기
  useEffect(() => {
    if (!selSlug) {
      setPreview(null)
      return
    }
    let stale = false
    setPreview({ state: 'loading' })
    fetch(`/api/pages/${encodeURIComponent(selSlug)}`)
      .then(async (r) => {
        if (stale) return
        if (!r.ok) {
          setPreview({ state: 'missing' })
          return
        }
        const p = await r.json()
        if (!stale)
          setPreview({ state: 'found', title: p.title, summary: p.summary, pageType: p.pageType })
      })
      .catch(() => !stale && setPreview({ state: 'missing' }))
    return () => {
      stale = true
    }
  }, [selSlug])

  if (error) return <div className="entity-graph empty">{error}</div>
  if (!data) return <div className="entity-graph empty">그래프를 불러오는 중…</div>

  return (
    <div className="entity-graph">
      <div className="canvas" ref={wrapRef}>
        <svg
          ref={svgRef}
          onPointerDown={(e) => {
            if ((e.target as Element).closest('.gnode')) return
            drag.current = { x: e.clientX - t.x, y: e.clientY - t.y }
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (!drag.current) return
            setT((prev) => ({ ...prev, x: e.clientX - drag.current!.x, y: e.clientY - drag.current!.y }))
          }}
          onPointerUp={() => {
            drag.current = null
          }}
          onClick={(e) => {
            if (!(e.target as Element).closest('.gnode')) setSelected(null)
          }}
          role="img"
          aria-label={`${data.name} 관계 그래프`}
        >
          <g transform={`translate(${t.x} ${t.y}) scale(${t.k})`}>
            {data.edges.map((e) => {
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
            {data.nodes.map((n) => {
              const p = pos[n.slug]
              if (!p) return null
              const r = radius(n.degree) + (n.slug === center?.slug ? 4 : 0)
              return (
                <g
                  key={n.slug}
                  className={`gnode entity${selected === n.slug ? ' sel' : ''}`}
                  transform={`translate(${p.x} ${p.y})`}
                  onClick={() => setSelected(n.slug)}
                >
                  <circle r={r} />
                  <text y={r + 14}>{n.title}</text>
                </g>
              )
            })}
          </g>
        </svg>

        <div className="graph-toolbar">
          <span className="scope">
            <Waypoints size={12} aria-hidden /> {data.name} · {data.type}
          </span>
          <span className="meta">
            {data.nodes.length - 1 < data.neighborCount
              ? `이웃 ${data.neighborCount}개 중 ${data.nodes.length - 1}`
              : `이웃 ${data.nodes.length - 1}`}{' '}
            · 관계 {data.edges.length}
          </span>
        </div>

        {/* 두 축 필터 — 종류(개체 계층)와 관계. 함께 걸면 둘 다 만족하는 이웃만 그린다.
            하나라도 고르면 상한이 50으로 올라간다. */}
        {(data.types.length > 1 || data.rels.length > 1) && (
          <div className="graph-filters">
            {data.types.length > 1 && (
              <div className="rel-chips" aria-label="개체 종류">
                <span className="k">종류</span>
                <button className={type === null ? 'on' : ''} onClick={() => setType(null)}>
                  전체
                </button>
                {data.types.map((t) => (
                  <button
                    key={t.type}
                    className={type === t.type ? 'on' : ''}
                    title={t.type}
                    onClick={() => setType(type === t.type ? null : t.type)}
                  >
                    {typeLabel(t.type)} {t.count}
                  </button>
                ))}
              </div>
            )}
            {data.rels.length > 1 && (
              <div className="rel-chips" aria-label="관계 종류">
                <span className="k">관계</span>
                <button className={rel === null ? 'on' : ''} onClick={() => setRel(null)}>
                  전체
                </button>
                {data.rels.map((r) => (
                  <button
                    key={r.rel}
                    className={rel === r.rel ? 'on' : ''}
                    onClick={() => setRel(rel === r.rel ? null : r.rel)}
                  >
                    {r.rel} {r.count}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

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

        {data.ambiguousCount > 1 && (
          <div className="warn">
            같은 이름의 개체가 {data.ambiguousCount}건 있습니다. 다른 개체일 수 있습니다.
          </div>
        )}

        {data.nodes.length <= 1 && (
          <div className="empty-mid">그래프에서 이 개체의 관계를 찾지 못했습니다.</div>
        )}
      </div>

      {/* 우측 패널 — 문서 그래프(/graph) 인스펙터와 같은 사용감 */}
      <aside className="graph-inspector" aria-label="개체 상세">
        {sel ? (
          isCenter ? (
            <div className="placeholder">지금 보고 있는 문서입니다.</div>
          ) : (
            <>
              <div className="head">
                <span className="ic">
                  <BookOpen size={18} aria-hidden />
                </span>
                <div className="t">
                  <h3>{sel.title}</h3>
                  <div className="path">/{selSlug}</div>
                </div>
              </div>

              {preview?.state === 'found' && (
                <>
                  <div className="sec">
                    <span className="badge">
                      {preview.pageType === 'entity' ? '온톨로지 개체' : '문서'}
                    </span>
                  </div>
                  {preview.summary && (
                    <div className="sec">
                      <h4>요약</h4>
                      <p className="summary">{preview.summary}</p>
                    </div>
                  )}
                </>
              )}
              {preview?.state === 'missing' && (
                <div className="sec">
                  <p className="summary">
                    아직 문서가 없습니다. 열면 그래프에서 문서를 만들 수 있습니다.
                  </p>
                </div>
              )}
              {preview?.state === 'loading' && <div className="sec placeholder">불러오는 중…</div>}

              <div className="foot">
                <a className="open-btn" href={wikiHref(selSlug)}>
                  문서 열기
                  <ExternalLink size={13} aria-hidden />
                </a>
              </div>
            </>
          )
        ) : (
          <div className="placeholder">노드를 선택하면 문서 미리보기가 표시됩니다.</div>
        )}
      </aside>
    </div>
  )
}
