'use client'
import { useEffect, useRef, useState } from 'react'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force'
import { THEME_EVENT } from '@/components/ui/ThemeToggle'

export type CanvasNode = SimulationNodeDatum & {
  id: string
  label: string
  group: string
  size: number
}

export type CanvasEdge = SimulationLinkDatum<CanvasNode> & {
  source: string | CanvasNode
  target: string | CanvasNode
  dashed?: boolean
}

type Palette = { edge: string; bridge: string; label: string; halo: string }

/** 캔버스는 CSS를 못 읽는다. 테마 토큰을 계산된 스타일에서 직접 꺼내온다. */
function readPalette(): Palette {
  const s = getComputedStyle(document.documentElement)
  const get = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback
  return {
    edge: get('--graph-edge', 'rgba(180,200,240,0.22)'),
    bridge: get('--graph-bridge', 'rgba(167,139,250,0.55)'),
    label: get('--graph-label', '#b9c4dc'),
    halo: get('--graph-halo', 'rgba(0,0,0,0.55)'),
  }
}

/**
 * d3-force로 물리만 돌리고 그리기는 직접 한다.
 * 시뮬레이션이 노드/엣지 객체를 제자리에서 변형(x·y 주입, source/target 객체 치환)하므로
 * 부모는 매 렌더마다 새 배열을 만들지 말고 안정된 참조를 넘겨야 한다.
 */
export function ForceCanvas({
  nodes,
  edges,
  colorOf,
  onNodeClick,
  onNodeDoubleClick,
  focusId,
}: {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  colorOf: (group: string) => string
  onNodeClick?: (id: string) => void
  onNodeDoubleClick?: (id: string) => void
  focusId?: string | null
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 })
  const [theme, setTheme] = useState(0)

  // 테마가 바뀌면 팔레트를 다시 읽어야 하므로 이펙트를 통째로 재실행한다.
  useEffect(() => {
    const bump = () => setTheme((n) => n + 1)
    window.addEventListener(THEME_EVENT, bump)
    return () => window.removeEventListener(THEME_EVENT, bump)
  }, [])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let palette = readPalette()
    let w = canvas.clientWidth
    let h = canvas.clientHeight

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      draw()
    }

    const sim = forceSimulation<CanvasNode>(nodes)
      .force(
        'link',
        forceLink<CanvasNode, CanvasEdge>(edges)
          .id((d) => d.id)
          .distance(78)
          .strength(0.35),
      )
      .force('charge', forceManyBody<CanvasNode>().strength(-210))
      .force('center', forceCenter(w / 2, h / 2))
      .force(
        'collide',
        forceCollide<CanvasNode>().radius((d) => d.size + 6),
      )
      .on('tick', draw)

    function draw() {
      if (!ctx) return
      const { scale, tx, ty } = viewRef.current
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.translate(tx, ty)
      ctx.scale(scale, scale)

      // 엣지 먼저 — 노드가 그 위에 앉는다
      ctx.lineWidth = 1
      for (const e of edges) {
        const s = e.source as CanvasNode
        const t = e.target as CanvasNode
        if (s.x == null || t.x == null) continue
        ctx.beginPath()
        ctx.setLineDash(e.dashed ? [3, 5] : [])
        ctx.strokeStyle = e.dashed ? palette.bridge : palette.edge
        ctx.moveTo(s.x, s.y!)
        ctx.lineTo(t.x, t.y!)
        ctx.stroke()
      }
      ctx.setLineDash([])

      for (const n of nodes) {
        if (n.x == null) continue
        const color = colorOf(n.group)
        const focused = focusId === n.id

        // 유리 느낌 — 노드마다 옅은 후광
        ctx.beginPath()
        ctx.fillStyle = color
        ctx.globalAlpha = 0.16
        ctx.arc(n.x, n.y!, n.size + 7, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1

        ctx.beginPath()
        ctx.fillStyle = color
        ctx.arc(n.x, n.y!, n.size, 0, Math.PI * 2)
        ctx.fill()

        if (focused) {
          ctx.lineWidth = 2
          ctx.strokeStyle = color
          ctx.beginPath()
          ctx.arc(n.x, n.y!, n.size + 5, 0, Math.PI * 2)
          ctx.stroke()
          ctx.lineWidth = 1
        }

        // 라벨은 배경색 후광을 깔아 어느 테마에서도 읽힌다
        ctx.font = '11px var(--font-plex-mono), monospace'
        ctx.lineWidth = 3
        ctx.strokeStyle = palette.halo
        ctx.strokeText(n.label, n.x + n.size + 5, n.y! + 3.5)
        ctx.fillStyle = palette.label
        ctx.fillText(n.label, n.x + n.size + 5, n.y! + 3.5)
        ctx.lineWidth = 1
      }
    }

    /** 화면 좌표를 시뮬레이션 좌표로 되돌린다 (팬·줌 반영). */
    const toWorld = (px: number, py: number) => {
      const { scale, tx, ty } = viewRef.current
      return { x: (px - tx) / scale, y: (py - ty) / scale }
    }

    const nodeAt = (ev: MouseEvent) => {
      const r = canvas.getBoundingClientRect()
      const { x, y } = toWorld(ev.clientX - r.left, ev.clientY - r.top)
      return nodes.find((n) => n.x != null && Math.hypot(n.x - x, n.y! - y) <= n.size + 4)
    }

    const onClick = (ev: MouseEvent) => {
      const n = nodeAt(ev)
      if (n && onNodeClick) onNodeClick(n.id)
    }
    const onDouble = (ev: MouseEvent) => {
      const n = nodeAt(ev)
      if (n && onNodeDoubleClick) onNodeDoubleClick(n.id)
    }
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      const v = viewRef.current
      v.scale = Math.min(4, Math.max(0.2, v.scale * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)))
      draw()
    }

    let dragging = false
    let lastX = 0
    let lastY = 0
    const onDown = (ev: MouseEvent) => {
      dragging = true
      lastX = ev.clientX
      lastY = ev.clientY
      canvas.style.cursor = 'grabbing'
    }
    const onMove = (ev: MouseEvent) => {
      if (!dragging) {
        canvas.style.cursor = nodeAt(ev) ? 'pointer' : 'grab'
        return
      }
      const v = viewRef.current
      v.tx += ev.clientX - lastX
      v.ty += ev.clientY - lastY
      lastX = ev.clientX
      lastY = ev.clientY
      draw()
    }
    const onUp = () => {
      dragging = false
      canvas.style.cursor = 'grab'
    }

    resize()

    canvas.addEventListener('click', onClick)
    canvas.addEventListener('dblclick', onDouble)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('mousedown', onDown)
    canvas.addEventListener('mousemove', onMove)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('resize', resize)

    return () => {
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('dblclick', onDouble)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('mousedown', onDown)
      canvas.removeEventListener('mousemove', onMove)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('resize', resize)
      sim.stop()
      void palette
    }
  }, [nodes, edges, colorOf, onNodeClick, onNodeDoubleClick, focusId, theme])

  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab' }} />
}
