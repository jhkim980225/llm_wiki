'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ForceCanvas, type CanvasEdge, type CanvasNode } from './ForceCanvas'
import { matchLayers } from '@/lib/graph/match'
import type { GraphEdge, GraphMeta, GraphNode } from '@/lib/graph/subset'
import type { EntityEdge, EntityNode } from '@/lib/fuseki/client'

const PAGE_TYPES = ['summary', 'entity', 'concept', 'index', 'synthesis', 'comparison'] as const

const TYPE_COLOR: Record<string, string> = {
  summary: '#4285f4',
  entity: '#34a853',
  concept: '#fbbc04',
  index: '#a142f4',
  synthesis: '#ff6d01',
  comparison: '#00acc1',
}
const ENTITY_COLOR = '#7f8c8d'

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
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div
        style={{
          position: 'absolute',
          zIndex: 2,
          padding: 12,
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
          background: 'rgba(255,255,255,0.9)',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="페이지 검색"
          style={{ padding: '4px 8px' }}
        />
        <label>
          <input type="checkbox" checked={wikiLayer} onChange={(e) => setWikiLayer(e.target.checked)} />
          위키 링크
        </label>
        <label>
          <input
            type="checkbox"
            checked={entityLayer}
            onChange={(e) => setEntityLayer(e.target.checked)}
          />
          개체(Fuseki)
        </label>
        {entities?.error && (
          <span style={{ color: '#c5221f' }}>Fuseki 레이어 사용 불가 — 위키는 정상</span>
        )}
        {mode === 'ego' && (
          <>
            <span>ego: {center}</span>
            <label>
              깊이
              <input
                type="number"
                min={1}
                max={3}
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
                style={{ width: 48, marginLeft: 4 }}
              />
            </label>
            <button onClick={() => { setMode('overview'); setCenter(null) }}>전체 보기</button>
          </>
        )}
        <span style={{ display: 'flex', gap: 8 }}>
          {PAGE_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => toggleType(t)}
              style={{
                opacity: activeTypes.has(t) ? 1 : 0.35,
                borderLeft: `10px solid ${TYPE_COLOR[t]}`,
                padding: '2px 6px',
              }}
            >
              {t}
            </button>
          ))}
        </span>
        {wiki && (
          <span style={{ color: '#5f6368' }}>
            {wiki.meta.returned} / {wiki.meta.total}
            {wiki.meta.truncated ? ' (잘림)' : ''}
          </span>
        )}
        {wikiError && <span style={{ color: '#c5221f' }}>{wikiError}</span>}
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
