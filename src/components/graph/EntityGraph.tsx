'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ExternalLink,
  Maximize,
  Minus,
  Plus,
  Waypoints,
} from 'lucide-react'
import type { GraphEdge, GraphNode, XY } from '@/lib/wiki/graph'
import { layoutGraph } from '@/lib/wiki/graph'
import { normalizeSlug } from '@/lib/wiki/slug'
import { digest } from '@/lib/wiki/digest'
import { wikiHref } from '@/lib/wiki/href'

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
  /** 중심 개체의 속성 — 아무 노드도 안 골랐을 때 인스펙터가 보여준다. */
  attrs: { key: string; value: string }[]
  /** 그린 이웃의 관계·방향·종류. 문서를 기다리지 않고 바로 그린다. */
  neighbors: { uri: string; rel: string; dir: 'in' | 'out'; types: string[] }[]
}

/**
 * 온톨로지 클래스명 → 화면 표시명. 소스마다 어휘가 달라 아는 것만 옮기고
 * 모르는 값은 원문 그대로 둔다 (칩이 사라지는 것보다 영문이 낫다).
 */
const TYPE_LABEL: Record<string, string> = {
  Person: '인물',
  Organization: '조직',
  OrganizationCluster: '조직(묶음)',
  // ejkim은 메일 1건을 여러 노드로 쪼갠다 — Email은 라벨만 있는 껍데기,
  // EmailMessage가 본문 쪽이다. 칩에 같은 이름이 둘 뜨면 고를 수 없어 갈라 둔다.
  EmailMessage: '메일',
  Email: '메일 헤더',
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

/**
 * 종류를 6개 묶음으로 접어 색을 준다. 타입은 소스마다 십수 종이라 하나씩 색을 주면
 * design.md가 금지한 무지개 노드가 된다 — 사람·조직·문서·업무·물건·그 외로만 가른다.
 * 소문자로 맞춰 비교한다(kakao는 documentType, ejkim은 Document 식으로 표기가 갈린다).
 */
const KIND_OF: Record<string, string> = {
  person: 'person',
  organization: 'org',
  organizationcluster: 'org',
  brand: 'org',
  emailmessage: 'doc',
  email: 'doc',
  emailthread: 'doc',
  emailaccount: 'doc',
  document: 'doc',
  documenttype: 'doc',
  businesscase: 'case',
  businessactivity: 'case',
  case: 'case',
  organizationroleevidence: 'case',
  relationshipassertion: 'case',
  product: 'thing',
  rawmaterial: 'thing',
  auxiliarymaterial: 'thing',
  material: 'thing',
  ingredient: 'thing',
  jobtitle: 'role',
  businessnumber: 'role',
}

/** 개체 종류 → 노드·칩 색 클래스. 모르는 타입은 기본 회색으로 둔다. */
const kindOf = (types: string[]): string => {
  for (const t of types) {
    const k = KIND_OF[t.toLowerCase()]
    if (k) return k
  }
  return 'etc'
}

/** 선택한 이웃의 문서 미리보기 — 있으면 요약·속성표, 없으면 만들기 안내. */
type Preview =
  | { state: 'loading' }
  | {
      state: 'found'
      title: string
      summary: string
      pageType: string
      rows: [string, string][]
      excerpt: string
      folded: number
      backlinkTotal: number
    }
  | { state: 'missing' }

/**
 * 적재기가 summary에 RDF 클래스명을 그대로 넣는다(실측: 전량이 "Organization" 같은 한 단어).
 * 그런 요약은 타입 배지와 같은 말이라 요약 자리에 둘 이유가 없다.
 */
const isClassName = (s: string) => !!s && !/\s/.test(s) && /^[A-Za-z]+$/.test(s)

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
  // 아무것도 안 골랐거나 중심을 골랐으면 중심 카드를 보여준다 — 예전엔 한 줄짜리
  // 안내만 떠서 패널의 60~70%가 빈 채로 남았다(실측).
  const showCenter = !sel || !!isCenter
  // 이웃 문서 주소는 라벨로 만든다 — 적재본·승격본이 같은 규칙(entitySlug)을 쓰므로
  // 이미 있는 문서면 그대로 열리고, 없으면 문서 없음 화면이 받는다.
  const selSlug = sel && data && !isCenter ? `${data.sourceId}/${normalizeSlug(sel.title)}` : ''

  // 선택한 이웃이 중심과 어떤 관계인지 — 그래프 응답에 이미 들어 있다.
  const selRels = useMemo(
    () => (sel && data ? data.neighbors.filter((n) => n.uri === sel.slug) : []),
    [sel, data],
  )
  const selTypes = useMemo(
    () => [...new Set(selRels.flatMap((n) => n.types))],
    [selRels],
  )

  // 노드 URI → 색 묶음. 중심은 GraphRef.type, 이웃은 rdf:type에서 얻는다.
  const kindByUri = useMemo(() => {
    const m = new Map<string, string>()
    if (!data) return m
    if (data.nodes[0]) m.set(data.nodes[0].slug, kindOf([data.type]))
    for (const n of data.neighbors) if (!m.has(n.uri)) m.set(n.uri, kindOf(n.types))
    return m
  }, [data])

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
        if (stale) return
        const d = digest(p.content ?? '')
        setPreview({
          state: 'found',
          title: p.title,
          summary: p.summary ?? '',
          pageType: p.pageType,
          rows: d.rows,
          excerpt: d.excerpt,
          folded: d.folded,
          backlinkTotal: p.backlinkTotal ?? 0,
        })
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
      <div className="main">
        {/* 두 축 필터 — 종류(개체 계층)와 관계. 함께 걸면 둘 다 만족하는 이웃만 그린다.
            하나라도 고르면 상한이 50으로 올라간다.
            캔버스 위에 겹치지 않게 정상 흐름에 둔다 — 칩이 5줄까지 늘어나는 개체가 있다. */}
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
                    className={`k-${kindOf([t.type])}${type === t.type ? ' on' : ''}`}
                    title={t.type}
                    onClick={() => setType(type === t.type ? null : t.type)}
                  >
                    <i className="dot" aria-hidden />
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
                  className={`gnode k-${kindByUri.get(n.slug) ?? 'etc'}${
                    selected === n.slug ? ' sel' : ''
                  }`}
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
          <div className="empty-mid">
            {rel || type
              ? '이 조건에 맞는 이웃이 없습니다.'
              : '그래프에서 이 개체의 관계를 찾지 못했습니다.'}
          </div>
        )}
        </div>
      </div>

      {/* 우측 패널 — 그래프 응답만으로 그릴 수 있는 것을 위에, 문서 조회가 필요한 것을 아래에.
          1MB짜리 문서를 기다리는 동안에도 패널이 비지 않는다. */}
      <aside className="graph-inspector" aria-label="개체 상세">
        <div className="head">
          <span className="ic">
            <BookOpen size={18} aria-hidden />
          </span>
          <div className="t">
            <h3>{showCenter ? data.name : sel!.title}</h3>
            <div className="path" title={showCenter ? data.center : selSlug}>
              /{showCenter ? data.center : selSlug}
            </div>
          </div>
        </div>

        {showCenter ? (
          <>
            <div className="sec">
              <span className="badge">{typeLabel(data.type)}</span>
              <span className="badge quiet">{data.sourceId}</span>
            </div>

            <div className="sec stats">
              <div className="stat">
                이웃<span className="v">{data.neighborCount}</span>
              </div>
              <div className="stat">
                관계<span className="v">{data.rels.length}종</span>
              </div>
              <div className="stat">
                종류<span className="v">{data.types.length}종</span>
              </div>
            </div>

            {data.attrs.length > 0 && (
              <div className="sec">
                <h4>속성</h4>
                <dl className="attrs">
                  {data.attrs.map((a) => (
                    <div key={a.key + a.value}>
                      <dt>{a.key}</dt>
                      <dd>{a.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {data.rels.length > 0 && (
              <div className="sec">
                <h4>주요 관계</h4>
                <ul className="rel-list">
                  {data.rels.slice(0, 5).map((r) => (
                    <li key={r.rel}>
                      <span className="n">{r.rel}</span>
                      <span className="c">{r.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!selected && data.nodes.length > 1 && (
              <p className="hint">노드를 선택하면 그 개체의 상세가 표시됩니다.</p>
            )}
          </>
        ) : (
          <>
            {/* 그래프 응답만으로 즉시 — 문서를 기다리지 않는다 */}
            {selRels.length > 0 && (
              <div className="sec">
                <h4>중심과의 관계</h4>
                <ul className="rel-list edges">
                  {selRels.map((r, i) => (
                    <li key={r.rel + r.dir + i}>
                      {r.dir === 'out' ? (
                        <ArrowRight size={12} aria-hidden />
                      ) : (
                        <ArrowLeft size={12} aria-hidden />
                      )}
                      <span className="n">{r.rel}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selTypes.length > 0 && (
              <div className="sec">
                {selTypes.map((t) => (
                  <span key={t} className="badge" title={t}>
                    {typeLabel(t)}
                  </span>
                ))}
              </div>
            )}

            {preview?.state === 'found' && (
              <>
                <div className="sec stats">
                  <div className="stat">
                    그래프 연결<span className="v">{sel!.degree}</span>
                  </div>
                  <div className="stat">
                    백링크<span className="v">{preview.backlinkTotal}</span>
                  </div>
                </div>

                {preview.summary && !isClassName(preview.summary) && (
                  <div className="sec">
                    <h4>요약</h4>
                    <p className="summary">{preview.summary}</p>
                  </div>
                )}

                {preview.rows.length > 0 ? (
                  <div className="sec">
                    <h4>속성</h4>
                    <dl className="attrs">
                      {preview.rows.map(([k, v]) => (
                        <div key={k + v}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                    {preview.folded > 0 && (
                      <p className="hint">같은 항목 {preview.folded}건 더 있음</p>
                    )}
                  </div>
                ) : (
                  preview.excerpt && (
                    <div className="sec">
                      <h4>본문</h4>
                      <p className="excerpt">{preview.excerpt}</p>
                    </div>
                  )
                )}
              </>
            )}
            {preview?.state === 'missing' && (
              <div className="sec">
                <p className="summary">
                  아직 문서가 없습니다. 열면 문서 없음 화면에서 만들 수 있습니다.
                </p>
              </div>
            )}
            {preview?.state === 'loading' && <div className="sec placeholder">문서 불러오는 중…</div>}
          </>
        )}

        <div className="foot">
          <a className="open-btn" href={wikiHref(showCenter ? data.center : selSlug)}>
            문서 열기
            <ExternalLink size={13} aria-hidden />
          </a>
        </div>
      </aside>
    </div>
  )
}
