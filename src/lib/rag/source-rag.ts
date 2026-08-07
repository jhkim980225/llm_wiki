/**
 * 소스별 전용 RAG API. 그래프 소스가 SPARQL 직조회 대신 저쪽 팀이 제공하는
 * 질의응답 API를 쓴다 — 질문을 그대로 넘기면 자연어 답변(answer)을 준다.
 * 2026-08-08부터 답변에 등장한 개체 목록(entities: [{name, type}])도 온다 —
 * 걸러서(cleanEntities) GraphRef에 쌓는다. 나머지 필드(timing·matches 등)는 무시한다.
 *
 * 실측: 답변 생성에 수십 초(내부 LLM). 타임아웃을 넉넉히 준다. 실패는 던지지 않고
 * ok:false로 흡수해 RAG 전체가 죽지 않게 한다.
 */
import { cleanEntities, type CleanEntity } from '@/lib/graph-ref/entities'

export type RagResult = { ok: boolean; answer?: string; entities?: CleanEntity[]; error?: string }

/** 소스 id → { env override, 기본 URL }. env가 있으면 그 값을 우선한다. */
const RAG_URLS: Record<string, { env: string; url: string }> = {
  ejkim: { env: 'EJKIM_RAG_URL', url: 'http://192.168.0.113:30311/ejkim/api/rag/ask' },
  kakao: { env: 'KAKAO_RAG_URL', url: 'http://192.168.0.114:30309/kakao/api/rag/ask' },
  seunghoon: { env: 'SEUNGHOON_RAG_URL', url: 'http://192.168.0.113:30313/api/rag/ask' },
}

/** 이 소스가 전용 RAG API를 가지는지. 없으면 SPARQL 직조회로 남는다. */
export const hasRagApi = (id: string): boolean => id in RAG_URLS

export const ragUrl = (id: string): string => {
  const entry = RAG_URLS[id]
  if (!entry) throw new Error(`no RAG API for source: ${id}`)
  return process.env[entry.env] || entry.url
}

export async function askSourceRag(
  id: string,
  question: string,
  timeoutMs = 120_000,
): Promise<RagResult> {
  try {
    const res = await fetch(ragUrl(id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const body = (await res.json()) as { answer?: unknown; entities?: unknown }
    if (typeof body.answer !== 'string' || !body.answer.trim()) {
      return { ok: false, error: '응답에 answer가 없다' }
    }

    // 개체는 GraphRef에 쌓는다 — 응답을 막지 않는다(fire-and-forget). 실패는 삼킨다.
    // 아직 entities를 안 주는 소스는 빈 배열이 되어 아무 일도 없다.
    const entities = cleanEntities(body.entities)
    if (entities.length > 0) void collectRefs(id, entities)

    return { ok: true, answer: body.answer, entities }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** 개체 → GraphRef upsert. 동적 import — 이 모듈을 쓰는 순수 테스트가 Prisma를 안 물게. */
async function collectRefs(sourceId: string, entities: CleanEntity[]): Promise<void> {
  try {
    const { upsertRef } = await import('@/lib/graph-ref/store')
    for (const e of entities) {
      await upsertRef({ name: e.name, type: e.type, sourceId }).catch(() => {})
    }
  } catch {
    // 수집 실패가 답변을 막으면 안 된다.
  }
}
