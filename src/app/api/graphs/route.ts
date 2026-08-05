import { NextResponse } from 'next/server'
import { fusekiHealth } from '@/lib/fuseki/client'
import { QUERY_SOURCES } from '@/lib/ontology/source'

export const maxDuration = 60

/**
 * LLM이 실시간으로 묻는 그래프가 지금 몇 개 붙는지.
 * 죽은 소스가 있어도 200으로 답한다 — 상태를 보러 온 요청이라 실패 자체가 답이다.
 */
export async function GET() {
  const started = Date.now()
  const sources = await Promise.all(
    QUERY_SOURCES.map(async (s) => {
      const at = Date.now()
      const health = await fusekiHealth(s)
      return {
        id: s.id,
        name: s.name,
        endpoint: `${s.url.replace(/\/+$/, '')}/${s.dataset}/sparql`,
        ...health,
        latencyMs: Date.now() - at,
      }
    }),
  )

  return NextResponse.json({
    // 닿는 것과 쓸 데이터가 있는 것은 다른 사실이다.
    connected: sources.filter((s) => s.ok).length,
    withData: sources.filter((s) => s.hasData).length,
    total: sources.length,
    latencyMs: Date.now() - started,
    sources,
  })
}
