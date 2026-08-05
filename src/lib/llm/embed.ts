/**
 * 임베딩 생성. 사내 Ollama의 embeddinggemma(768차원)를 쓴다.
 * vLLM은 임베딩 엔드포인트를 안 열어 두므로 임베딩은 Ollama 고정이다.
 */
export const EMBED_DIM = 768

type Env = Record<string, string | undefined>

export function embedConfig(env: Env = process.env) {
  return {
    url: env.EMBED_URL || 'http://192.168.0.152:11434',
    model: env.EMBED_MODEL || 'embeddinggemma',
  }
}

export async function embed(text: string, cfg = embedConfig()): Promise<number[]> {
  const res = await fetch(`${cfg.url}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: cfg.model, prompt: text }),
  })
  if (!res.ok) throw new Error(`embed failed: HTTP ${res.status}`)
  const data = (await res.json()) as { embedding?: number[] }
  const e = data.embedding
  if (!Array.isArray(e) || e.length !== EMBED_DIM) {
    throw new Error(`embed returned unexpected dim: ${e?.length ?? 'none'}`)
  }
  return e
}

/** pgvector 리터럴 문자열. $queryRaw에 캐스팅해 넣는다: `${lit}::vector`. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`
}
