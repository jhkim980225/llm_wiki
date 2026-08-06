import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { IMPORT_SOURCE } from '@/lib/ontology/import'
import { buildGraph, topConnected } from '@/lib/wiki/graph'

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 1000

/**
 * 그래프 뷰 데이터 — 문서 노드 + 위키링크 에지. 계산은 lib/wiki/graph가 한다.
 * 문서 트리와 같은 기준으로 **사람·에이전트가 쓴 문서만** 그린다 — 온톨로지 적재본
 * 수만 건이 들어오면 그래프가 키워드 구름이 된다. 적재본까지 보려면 ?all=1.
 */
export async function GET(req: Request) {
  const u = new URL(req.url)
  const limit = Math.min(Number(u.searchParams.get('limit')) || DEFAULT_LIMIT, MAX_LIMIT)
  const all = u.searchParams.get('all') === '1'

  const pages = await db.page.findMany({
    where: {
      deletedAt: null,
      ...(all ? {} : { lastEditSource: { not: IMPORT_SOURCE } }),
    },
    select: { slug: true, title: true, pageType: true, outLinks: true },
  })
  const full = buildGraph(pages)
  const sub = topConnected(full, limit)
  return NextResponse.json({
    ...sub,
    total: { nodes: full.nodes.length, edges: full.edges.length },
  })
}
