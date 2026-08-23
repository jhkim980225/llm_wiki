import { requireSession } from '@/lib/auth/guard'

/**
 * LightRAG PoC 프록시 — /lightrag 테스트 화면이 쓴다.
 * 브라우저가 직접 못 붙는 이유: 클러스터 내부 서비스 + API 키 노출 방지.
 * 운영은 http://lightrag:9621(서비스 DNS), 개발은 NodePort(.env 참조).
 */
export const maxDuration = 300

const MODES = new Set(['local', 'global', 'hybrid', 'naive', 'mix'])

export async function POST(req: Request) {
  const authed = await requireSession()
  if (!authed) return Response.json({ error: '로그인이 필요합니다' }, { status: 401 })
  // 실험 탭과 동일하게 bench 계정 전용 — LUNA 비용이 나가는 경로라 좁혀 둔다
  if (authed.user.loginId !== 'bench') {
    return Response.json({ error: 'bench 계정 전용 실험 기능입니다' }, { status: 403 })
  }

  const base = process.env.LIGHTRAG_URL
  if (!base) return Response.json({ error: 'LIGHTRAG_URL 미설정' }, { status: 503 })

  const { query, mode } = await req.json().catch(() => ({}))
  if (typeof query !== 'string' || !query.trim() || query.length > 2000) {
    return Response.json({ error: '질문이 비었거나 너무 깁니다' }, { status: 400 })
  }
  if (!MODES.has(mode)) return Response.json({ error: `mode는 ${[...MODES].join('·')} 중 하나` }, { status: 400 })

  const t0 = Date.now()
  const upstream = await fetch(`${base}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.LIGHTRAG_API_KEY ?? '',
    },
    body: JSON.stringify({ query: query.trim(), mode }),
    // LUNA 추출·합성이 느릴 수 있다 — 넉넉히
    signal: AbortSignal.timeout(240_000),
  }).catch(() => null)
  if (!upstream) return Response.json({ error: 'LightRAG 응답 없음 (타임아웃/연결 실패)' }, { status: 502 })

  const body = await upstream.json().catch(() => null)
  if (!upstream.ok || !body) {
    return Response.json({ error: `LightRAG ${upstream.status}` }, { status: 502 })
  }
  return Response.json({ response: body.response ?? '', durationMs: Date.now() - t0 })
}
