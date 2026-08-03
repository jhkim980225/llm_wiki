import { NextResponse } from 'next/server'
import { llmConfig } from '@/lib/llm/provider'

/**
 * LLM 백엔드 상태. 문서 처리가 "즉시 끝난 것처럼" 보일 때 여기부터 본다 —
 * 일을 한 게 아니라 연결이 끊긴 것일 수 있다.
 */
export async function GET() {
  const config = llmConfig()
  const started = Date.now()

  try {
    const res = await fetch(`${config.baseURL}/models`, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) {
      return NextResponse.json(
        { backend: config.backend, baseURL: config.baseURL, ok: false, error: `HTTP ${res.status}` },
        { status: 200 },
      )
    }
    const body = (await res.json()) as { data?: { id: string }[] }
    const served = body.data?.map((m) => m.id) ?? []
    return NextResponse.json({
      backend: config.backend,
      baseURL: config.baseURL,
      model: config.model,
      ok: true,
      modelAvailable: served.includes(config.model),
      served,
      latencyMs: Date.now() - started,
    })
  } catch (e) {
    // 연결 실패는 위키를 막지 않는다. 채팅만 못 쓴다.
    return NextResponse.json({
      backend: config.backend,
      baseURL: config.baseURL,
      model: config.model,
      ok: false,
      error: (e as Error).message,
      latencyMs: Date.now() - started,
    })
  }
}
