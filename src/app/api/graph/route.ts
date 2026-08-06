import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildGraph, topConnected } from '@/lib/wiki/graph'

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 1000

/**
 * 그래프 뷰 데이터 — 문서 노드 + 위키링크 에지. 계산은 lib/wiki/graph가 한다.
 * 실데이터가 온톨로지 개체 9.7만 문서라 화면엔 연결 상위 limit개만 준다.
 * ponytail: 전체 문서를 매 요청 다시 읽는다 — 수백 ms 수준. 느려지면 degree 컬럼 캐시.
 */
export async function GET(req: Request) {
  const u = new URL(req.url)
  const limit = Math.min(Number(u.searchParams.get('limit')) || DEFAULT_LIMIT, MAX_LIMIT)

  const pages = await db.page.findMany({
    where: { deletedAt: null },
    select: { slug: true, title: true, pageType: true, outLinks: true },
  })
  const full = buildGraph(pages)
  const sub = topConnected(full, limit)
  return NextResponse.json({
    ...sub,
    total: { nodes: full.nodes.length, edges: full.edges.length },
  })
}
