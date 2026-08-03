import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

export type LlmBackend = 'vllm' | 'ollama'

export type LlmConfig = {
  backend: LlmBackend
  baseURL: string
  model: string
  apiKey?: string
}

const DEFAULTS: Record<LlmBackend, { baseURL: string; model: string }> = {
  // 사내 vLLM (MetalLB). 인증 없음, OpenAI 호환.
  vllm: { baseURL: 'http://192.168.10.7/v1', model: 'qwen3-32b-finance' },
  // 사내 Ollama. vLLM이 죽었을 때의 대체 경로.
  ollama: { baseURL: 'http://192.168.0.152:11434/v1', model: 'qwen3:14b' },
}

type Env = Record<string, string | undefined>

export function llmConfig(env: Env = process.env): LlmConfig {
  const backend: LlmBackend = env.LLM_BACKEND === 'ollama' ? 'ollama' : 'vllm'
  const d = DEFAULTS[backend]
  return {
    backend,
    baseURL: env.LLM_BASE_URL || d.baseURL,
    model: env.LLM_MODEL || d.model,
    apiKey: env.LLM_API_KEY || undefined,
  }
}

/**
 * qwen3는 답변 앞에 사고 과정을 수천 토큰 뱉는다. 끄지 않으면 호출당 3~10배 느려진다
 * (실측: thinking on 817~4,650 토큰 / off 202~486 토큰).
 * vLLM은 `chat_template_kwargs.enable_thinking`으로 이걸 제어한다.
 *
 * openai-compatible 프로바이더는 자기가 모르는 providerOptions 키를 요청 body에
 * 그대로 실어 보낸다. 그래서 이 객체가 곧 body의 추가 필드가 된다.
 * 키는 프로바이더 이름과 같아야 하므로 createOpenAICompatible의 name과 맞춰 둔다.
 */
export function llmProviderOptions(config: LlmConfig = llmConfig()) {
  if (config.backend !== 'vllm') return undefined
  return { vllm: { chat_template_kwargs: { enable_thinking: false } } }
}

export function llmModel(config: LlmConfig = llmConfig()): LanguageModel {
  const provider = createOpenAICompatible({
    name: config.backend,
    baseURL: config.baseURL,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
  })
  return provider(config.model)
}
