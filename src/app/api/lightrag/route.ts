import { requireSession } from '@/lib/auth/guard'

/**
 * LightRAG PoC 프록시 — /lightrag 테스트 화면이 쓴다.
 * 브라우저가 직접 못 붙는 이유: 클러스터 내부 서비스 + API 키 노출 방지.
 * 운영은 http://lightrag:9621(서비스 DNS), 개발은 NodePort(.env 참조).
 */
export const maxDuration = 300

const MODES = new Set(['local', 'global', 'hybrid', 'naive', 'mix'])

async function guard() {
  const authed = await requireSession()
  if (!authed) return Response.json({ error: '로그인이 필요합니다' }, { status: 401 })
  // 실험 탭과 동일하게 bench 계정 전용 — LUNA 비용이 나가는 경로라 좁혀 둔다
  if (authed.user.loginId !== 'bench') {
    return Response.json({ error: 'bench 계정 전용 실험 기능입니다' }, { status: 403 })
  }
  const base = process.env.LIGHTRAG_URL
  if (!base) return Response.json({ error: 'LIGHTRAG_URL 미설정' }, { status: 503 })
  return base
}

function upstreamGet(base: string, path: string) {
  return fetch(`${base}${path}`, {
    headers: { 'X-API-Key': process.env.LIGHTRAG_API_KEY ?? '' },
    signal: AbortSignal.timeout(15_000),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
}

/**
 * 확인용 조회 — 색인 상태·문서 목록·그래프 라벨. 화이트리스트 프록시라
 * 임의 경로 전달은 없다. LLM을 타지 않아 비용 0.
 */
export async function GET(req: Request) {
  const base = await guard()
  if (base instanceof Response) return base

  const view = new URL(req.url).searchParams.get('view')
  if (view === 'status') {
    const [health, counts, pipeline] = await Promise.all([
      upstreamGet(base, '/health'),
      upstreamGet(base, '/documents/status_counts'),
      upstreamGet(base, '/documents/pipeline_status'),
    ])
    if (!health) return Response.json({ error: 'LightRAG 응답 없음' }, { status: 502 })
    return Response.json({
      status: health.status ?? null,
      coreVersion: health.core_version ?? null,
      llmModel: health.configuration?.llm_model ?? null,
      summaryLanguage: health.configuration?.summary_language ?? null,
      counts: counts?.status_counts ?? counts ?? {},
      busy: pipeline?.busy ?? null,
    })
  }
  if (view === 'documents') {
    const body = await upstreamGet(base, '/documents')
    if (!body) return Response.json({ error: 'LightRAG 응답 없음' }, { status: 502 })
    const docs = Object.entries((body.statuses ?? {}) as Record<string, Record<string, unknown>[]>)
      .flatMap(([status, list]) =>
        (list ?? []).map((d) => ({
          id: String(d.file_path ?? d.id ?? ''),
          status,
          length: typeof d.content_length === 'number' ? d.content_length : null,
          updatedAt: typeof d.updated_at === 'string' ? d.updated_at : null,
          error: typeof d.error_msg === 'string' ? d.error_msg : null,
        })),
      )
    return Response.json({ documents: docs })
  }
  if (view === 'labels') {
    const labels = await upstreamGet(base, '/graph/label/list')
    if (!Array.isArray(labels)) return Response.json({ error: 'LightRAG 응답 없음' }, { status: 502 })
    return Response.json({ labels })
  }
  return Response.json({ error: 'view는 status·documents·labels 중 하나' }, { status: 400 })
}

export async function POST(req: Request) {
  const base = await guard()
  if (base instanceof Response) return base

  const { query, mode, raw } = await req.json().catch(() => ({}))
  if (typeof query !== 'string' || !query.trim() || query.length > 2000) {
    return Response.json({ error: '질문이 비었거나 너무 깁니다' }, { status: 400 })
  }
  if (!MODES.has(mode)) return Response.json({ error: `mode는 ${[...MODES].join('·')} 중 하나` }, { status: 400 })

  const t0 = Date.now()
  // raw=true → /query/data: LLM 답변 생성 없이 검색 원자료(청크·개체·관계)만.
  // 청킹·검색 품질을 눈으로 확인하는 용도라 비용이 거의 없다.
  const upstream = await fetch(`${base}${raw === true ? '/query/data' : '/query'}`, {
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
  if (raw === true) {
    const d = body.data ?? {}
    return Response.json({
      chunks: (Array.isArray(d.chunks) ? d.chunks : []).map(
        (c: { chunk_id?: string; file_path?: string; content?: string }) => ({
          id: String(c.chunk_id ?? ''),
          doc: String(c.file_path ?? ''),
          content: String(c.content ?? ''),
        }),
      ),
      entities: Array.isArray(d.entities) ? d.entities : [],
      relationships: Array.isArray(d.relationships) ? d.relationships : [],
      durationMs: Date.now() - t0,
    })
  }
  // references: 답변 근거 문서 목록 [{reference_id, file_path}] — 정합성 확인에 쓴다
  const references = Array.isArray(body.references)
    ? body.references.map((r: { reference_id?: string; file_path?: string }) => ({
        id: String(r.reference_id ?? ''),
        doc: String(r.file_path ?? ''),
      }))
    : []
  return Response.json({ response: body.response ?? '', references, durationMs: Date.now() - t0 })
}
