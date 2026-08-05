import { generateText } from 'ai'
import type { z } from 'zod'
import { llmConfig, llmModel, llmProviderOptions } from '@/lib/llm/provider'

/**
 * LLM에게 JSON을 받아 스키마로 검증한다.
 *
 * AI SDK의 generateObject를 쓰지 않는다. 그건 프로바이더의 구조화 출력
 * (json_schema response_format / guided decoding)에 기대는데, 사내 vLLM은 그걸
 * 지원하지 않아 "No object generated: response did not match schema"로 죽는다.
 * 평문으로 받아 직접 파싱하면 백엔드를 안 가린다.
 */
export async function generateJson<T extends z.ZodTypeAny>(opts: {
  schema: T
  system: string
  prompt: string
  /** 파싱이나 검증에 실패했을 때 다시 물어볼 횟수. */
  retries?: number
}): Promise<z.infer<T>> {
  const config = llmConfig()
  const retries = opts.retries ?? 1
  let lastError = ''

  for (let attempt = 0; attempt <= retries; attempt++) {
    const { text } = await generateText({
      model: llmModel(config),
      providerOptions: llmProviderOptions(config),
      system:
        `${opts.system}\n\n` +
        '반드시 JSON 객체 하나만 출력한다. 설명·머리말·코드펜스를 붙이지 마라.',
      prompt: attempt === 0 ? opts.prompt : `${opts.prompt}\n\n이전 응답이 잘못됐다: ${lastError}`,
    })

    const raw = extractJson(text)
    if (!raw) {
      lastError = 'JSON 객체를 찾지 못했다'
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      lastError = `JSON 파싱 실패: ${(e as Error).message}`
      continue
    }

    const result = opts.schema.safeParse(parsed)
    if (result.success) return result.data
    lastError = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
  }

  throw new Error(`LLM이 올바른 JSON을 주지 않았다 — ${lastError}`)
}

/**
 * 응답에서 JSON 객체를 꺼낸다. 코드펜스로 감싸거나 앞뒤에 말을 붙이는 모델이 흔하다.
 * 중괄호 깊이를 세어 첫 객체의 끝을 찾는다 — 문자열 안의 괄호는 건너뛴다.
 */
export function extractJson(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const c = text[i]

    if (escaped) {
      escaped = false
      continue
    }
    if (c === '\\') {
      escaped = true
      continue
    }
    if (c === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}
