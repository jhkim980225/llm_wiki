'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ForceCanvas, type CanvasEdge, type CanvasNode } from './ForceCanvas'
import { matchLayers } from '@/lib/graph/match'
import type { GraphEdge, GraphMeta, GraphNode } from '@/lib/graph/subset'
import type { EntityEdge, EntityNode } from '@/lib/fuseki/client'

const PAGE_TYPES = ['summary', 'entity', 'concept', 'index', 'synthesis', 'comparison'] as const

/** 오로라 배경 위에서 서로 구분되는 색. 다크·라이트 양쪽에서 대비가 선다. */
const TYPE_COLOR: Record<string, string> = {
  summary: '#38bdf8',
  entity: '#34d399',
  concept: '#fbbf24',
  index: '#a78bfa',
  synthesis: '#fb7185',
  comparison: '#22d3ee',
}
const ENTITY_COLOR = '#94a3b8'

type WikiGraph = { nodes: GraphNode[]; edges: GraphEdge[]; meta: GraphMeta }
type EntityGraph = { nodes: EntityNode[]; edges: EntityEdge[]; error?: string }

export function GraphView() {
  const router = useRouter()

  const [mode, setMode] = useState<'overview' | 'ego'>('overview')
  const [center, setCenter] = useState<string | null>(null)
  const [depth, setDepth] = useState(1)
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set(PAGE_TYPES))
  const [query, setQuery] = useState('')
  const [focusId, setFocusId] = useState<string | null>(null)

  const [wiki, setWiki] = useState<WikiGraph | null>(null)
  const [wikiError, setWikiError] = useState<string | null>(null)

  const [entityLayer, setEntityLayer] = useState(false)
  const [entities, setEntities] = useState<EntityGraph | null>(null)
  const [wikiLayer, setWikiLayer] = useState(true)

  // 위키 링크 레이어
  useEffect(() => {
    const params = new URLSearchParams({ mode, depth: String(depth) })
    if (mode === 'ego' && center) params.set('center', center)
    if (activeTypes.size < PAGE_TYPES.length) params.set('types', [...activeTypes].join(','))

    let cancelled = false
    fetch(`/api/graph?${params}`)
      .then(async (r) => {
        const body = await r.json()
        if (cancelled) return
        if (!r.ok) {
          setWikiError(body.error ?? `HTTP ${r.status}`)
          return
        }
        setWikiError(null)
        setWiki(body)
      })
      .catch((e) => !cancelled && setWikiError(String(e)))
    return () => {
      cancelled = true
    }
  }, [mode, center, depth, activeTypes])

  // Fuseki 개체 레이어 — 현재 보이는 페이지 이름으로만 조회한다.
  useEffect(() => {
    if (!entityLayer || !wiki) {
      setEntities(null)
      return
    }
    const labels = wiki.nodes.map((n) => n.title).filter(Boolean)
    if (labels.length === 0) {
      setEntities({ nodes: [], edges: [] })
      return
    }

    let cancelled = false
    fetch(`/api/graph/entities?labels=${encodeURIComponent(labels.join(','))}`)
      .then((r) => r.json())
      .then((body) => !cancelled && setEntities(body))
      .catch((e) => !cancelled && setEntities({ nodes: [], edges: [], error: String(e) }))
    return () => {
      cancelled = true
    }
  }, [entityLayer, wiki])

  const { nodes, edges } = useMemo(() => {
    const canvasNodes: CanvasNode[] = []
    const canvasEdges: CanvasEdge[] = []

    if (wikiLayer && wiki) {
      for (const n of wiki.nodes) {
        canvasNodes.push({
          id: `page:${n.slug}`,
          label: n.title,
          group: n.pageType,
          size: 4 + Math.min(10, n.linkCount),
        })
      }
      for (const e of wiki.edges) {
        canvasEdges.push({ source: `page:${e.source}`, target: `page:${e.target}` })
      }
    }

    if (entityLayer && entities) {
      for (const n of entities.nodes) {
        canvasNodes.push({ id: `ent:${n.uri}`, label: n.label, group: '__entity', size: 5 })
      }
      for (const e of entities.edges) {
        canvasEdges.push({ source: `ent:${e.source}`, target: `ent:${e.target}` })
      }

      // 레이어 간 다리 — 이름이 완전히 같은 페이지와 개체를 점선으로 잇는다.
      if (wikiLayer && wiki) {
        const pageMeta = wiki.nodes.map((n) => ({ slug: n.slug, title: n.title, aliases: [] }))
        for (const m of matchLayers(pageMeta, entities.nodes)) {
          canvasEdges.push({
            source: `page:${m.pageSlug}`,
            target: `ent:${m.entityUri}`,
            dashed: true,
          })
        }
      }
    }

    return { nodes: canvasNodes, edges: canvasEdges }
    // 시뮬레이션이 배열을 제자리에서 변형하므로 의존성이 바뀔 때만 새 배열을 만든다.
  }, [wiki, entities, wikiLayer, entityLayer])

  const colorOf = useCallback(
    (group: string) => (group === '__entity' ? ENTITY_COLOR : (TYPE_COLOR[group] ?? '#9aa0a6')),
    [],
  )

  const openNode = useCallback(
    (id: string) => {
      if (id.startsWith('page:')) router.push(`/wiki/${id.slice(5)}`)
    },
    [router],
  )

  const focusEgo = useCallback((id: string) => {
    if (!id.startsWith('page:')) return
    setCenter(id.slice(5))
    setMode('ego')
  }, [])

  const toggleType = (t: string) => {
    setActiveTypes((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  const search = () => {
    const q = query.trim().toLowerCase()
    if (!q || !wiki) return
    const hit = wiki.nodes.find(
      (n) => n.title.toLowerCase().includes(q) || n.slug.toLowerCase().includes(q),
    )
    setFocusId(hit ? `page:${hit.slug}` : null)
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 3.4rem)' }}>
      {/* 조작 패널 — 캔버스 위에 떠 있는 유리판 */}
      <div
        className="glass rise"
        style={{
          position: 'absolute',
          zIndex: 3,
          top: '1rem',
          left: '1rem',
          right: '1rem',
          padding: '0.7rem 0.9rem',
          display: 'flex',
          gap: '0.7rem',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="페이지 검색 ⏎"
          style={{ minWidth: '12rem' }}
        />

        <span className="row" style={{ gap: '0.4rem' }}>
          <button
            className={wikiLayer ? '' : 'ghost'}
            onClick={() => setWikiLayer(!wikiLayer)}
            style={{ opacity: wikiLayer ? 1 : 0.5 }}
          >
            위키 링크
          </button>
          <button
            className={entityLayer ? '' : 'ghost'}
            onClick={() => setEntityLayer(!entityLayer)}
            style={{ opacity: entityLayer ? 1 : 0.5 }}
          >
            개체 · Fuseki
          </button>
        </span>

        {entities?.error && <span className="notice">Fuseki 레이어 사용 불가 — 위키는 정상</span>}

        {mode === 'ego' && (
          <span className="row" style={{ gap: '0.4rem' }}>
            <span className="chip on" style={{ color: 'var(--accent)' }}>
              ego · {center}
            </span>
            <input
              type="number"
              min={1}
              max={3}
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
              style={{ width: '4rem' }}
              aria-label="탐색 깊이"
            />
            <button
              className="ghost"
              onClick={() => {
                setMode('overview')
                setCenter(null)
              }}
            >
              전체 보기
            </button>
          </span>
        )}

        <span className="spacer" style={{ flex: 1 }} />

        {wiki && (
          <span className="meta">
            {wiki.meta.returned} / {wiki.meta.total}
            {wiki.meta.truncated ? ' · 잘림' : ''}
          </span>
        )}
        {wikiError && <span className="notice">{wikiError}</span>}
      </div>

      {/* 범례 — 타입별 필터 */}
      <div
        className="glass rise"
        style={{
          position: 'absolute',
          zIndex: 3,
          left: '1rem',
          bottom: '1rem',
          padding: '0.7rem 0.85rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.35rem',
        }}
      >
        <span className="eyebrow">레이어 · 타입</span>
        {PAGE_TYPES.map((t) => (
          <button
            key={t}
            className="ghost"
            onClick={() => toggleType(t)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.15em 0.3em',
              opacity: activeTypes.has(t) ? 1 : 0.38,
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              letterSpacing: '0.06em',
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 999,
                background: TYPE_COLOR[t],
                boxShadow: `0 0 10px ${TYPE_COLOR[t]}`,
                flexShrink: 0,
              }}
            />
            {t}
          </button>
        ))}
        {entityLayer && (
          <span
            className="meta"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.2rem' }}
          >
            <span
              style={{ width: 9, height: 9, borderRadius: 999, background: ENTITY_COLOR, flexShrink: 0 }}
            />
            개체
          </span>
        )}
      </div>

      <div
        className="meta"
        style={{ position: 'absolute', zIndex: 3, right: '1rem', bottom: '1rem', textAlign: 'right' }}
      >
        휠 확대 · 끌어 이동 · 클릭하면 문서 · 두 번 누르면 그 노드 중심
      </div>

      <ForceCanvas
        nodes={nodes}
        edges={edges}
        colorOf={colorOf}
        onNodeClick={openNode}
        onNodeDoubleClick={focusEgo}
        focusId={focusId}
      />
    </div>
  )
}
