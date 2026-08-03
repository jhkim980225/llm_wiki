'use client'
import { useEffect, useRef } from 'react'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force'

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

/**
 * d3-force로 물리만 돌리고 그리기는 직접 한다.
 * 노드/엣지 객체는 시뮬레이션이 제자리에서 변형(x·y 주입, source/target 객체 치환)하므로
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

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = canvas.clientWidth * dpr
      canvas.height = canvas.clientHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const w = canvas.clientWidth
    const h = canvas.clientHeight

    const sim = forceSimulation<CanvasNode>(nodes)
      .force(
        'link',
        forceLink<CanvasNode, CanvasEdge>(edges)
          .id((d) => d.id)
          .distance(70)
          .strength(0.4),
      )
      .force('charge', forceManyBody<CanvasNode>().strength(-180))
      .force('center', forceCenter(w / 2, h / 2))
      .force(
        'collide',
        forceCollide<CanvasNode>().radius((d) => d.size + 5),
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

      ctx.lineWidth = 1
      for (const e of edges) {
        const s = e.source as CanvasNode
        const t = e.target as CanvasNode
        if (s.x == null || t.x == null) continue
        ctx.beginPath()
        ctx.setLineDash(e.dashed ? [4, 4] : [])
        ctx.strokeStyle = e.dashed ? '#9aa0a6' : '#d0d4d9'
        ctx.moveTo(s.x, s.y!)
        ctx.lineTo(t.x, t.y!)
        ctx.stroke()
      }
      ctx.setLineDash([])

      for (const n of nodes) {
        if (n.x == null) continue
        const focused = focusId === n.id
        ctx.beginPath()
        ctx.fillStyle = colorOf(n.group)
        ctx.arc(n.x, n.y!, n.size, 0, Math.PI * 2)
        ctx.fill()
        if (focused) {
          ctx.lineWidth = 2
          ctx.strokeStyle = '#f5a623'
          ctx.stroke()
          ctx.lineWidth = 1
        }
        ctx.fillStyle = '#3c4043'
        ctx.font = '11px sans-serif'
        ctx.fillText(n.label, n.x + n.size + 3, n.y! + 3)
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
      return nodes.find((n) => n.x != null && Math.hypot(n.x - x, n.y! - y) <= n.size + 3)
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
      const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1
      v.scale = Math.min(4, Math.max(0.2, v.scale * factor))
      draw()
    }

    let dragging = false
    let lastX = 0
    let lastY = 0
    const onDown = (ev: MouseEvent) => {
      dragging = true
      lastX = ev.clientX
      lastY = ev.clientY
    }
    const onMove = (ev: MouseEvent) => {
      if (!dragging) return
      const v = viewRef.current
      v.tx += ev.clientX - lastX
      v.ty += ev.clientY - lastY
      lastX = ev.clientX
      lastY = ev.clientY
      draw()
    }
    const onUp = () => {
      dragging = false
    }

    canvas.addEventListener('click', onClick)
    canvas.addEventListener('dblclick', onDouble)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('resize', resize)

    return () => {
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('dblclick', onDouble)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('resize', resize)
      sim.stop()
    }
  }, [nodes, edges, colorOf, onNodeClick, onNodeDoubleClick, focusId])

  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}
