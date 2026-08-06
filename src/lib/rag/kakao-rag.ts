/**
 * 카카오 지식그래프 전용 RAG API.
 *
 * kakao 소스는 SPARQL 직조회 대신 저쪽 팀이 제공하는 질의응답 API를 쓴다 —
 * 질문을 그대로 넘기면 자연어 답변(answer)을 준다. 응답의 나머지 필드(timing 등)는
 * 무시한다. 소스별 직조회 → 전용 API 전환의 첫 번째 (feat/source-apis).
 *
 * 실측: 답변 생성에 40초 안팎 (내부 LLM). 타임아웃을 넉넉히 준다.
 */
const DEFAULT_URL = 'http://192.168.0.114:30309/kakao/api/rag/ask'

export const kakaoRagUrl = (): string => process.env.KAKAO_RAG_URL || DEFAULT_URL

export type KakaoRagResult = { ok: boolean; answer?: string; error?: string }

export async function askKakaoRag(question: string, timeoutMs = 120_000): Promise<KakaoRagResult> {
  try {
    const res = await fetch(kakaoRagUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const body = (await res.json()) as { answer?: unknown }
    if (typeof body.answer !== 'string' || !body.answer.trim()) {
      return { ok: false, error: '응답에 answer가 없다' }
    }
    return { ok: true, answer: body.answer }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
