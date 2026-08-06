import type { Metadata } from 'next'
import { GraphView } from '@/components/graph/GraphView'

export const metadata: Metadata = { title: '그래프 — 주식회사 성진' }

export default function GraphPage() {
  return <GraphView />
}
