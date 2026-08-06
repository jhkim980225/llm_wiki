import type { Metadata } from 'next'
import { GraphView } from '@/components/graph/GraphView'

export const metadata: Metadata = { title: '그래프 — GraphWiki' }

export default function GraphPage() {
  return <GraphView />
}
