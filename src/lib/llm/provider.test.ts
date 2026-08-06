import { describe, it, expect, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { generateText } from 'ai'
import { llmConfig, llmProviderOptions, llmModel } from './provider'

describe('llmConfig', () => {
  it('기본은 vLLM이다', () => {
    const c = llmConfig({})
    expect(c.backend).toBe('vllm')
    expect(c.baseURL).toBe('http://192.168.10.7/v1')
    expect(c.model).toBe('qwen3-32b-finance')
  })

  it('LLM_BACKEND=ollama로 대체 경로를 쓴다', () => {
    const c = llmConfig({ LLM_BACKEND: 'ollama' })
    expect(c.backend).toBe('ollama')
    expect(c.model).toBe('qwen3:14b')
  })

  it('LLM_BACKEND=openai면 OpenAI API 기본값을 쓴다', () => {
    const c = llmConfig({ LLM_BACKEND: 'openai', LLM_API_KEY: 'sk-x' })
    expect(c.backend).toBe('openai')
    expect(c.baseURL).toBe('https://api.openai.com/v1')
    expect(c.model).toBe('gpt-5.6-luna')
    expect(c.apiKey).toBe('sk-x')
  })

  it('환경변수가 기본값을 이긴다', () => {
    const c = llmConfig({ LLM_BASE_URL: 'http://x/v1', LLM_MODEL: 'm' })
    expect(c.baseURL).toBe('http://x/v1')
    expect(c.model).toBe('m')
  })
})

describe('llmProviderOptions', () => {
  it('vLLM이면 thinking을 끈다', () => {
    const o = llmProviderOptions({ backend: 'vllm', baseURL: '', model: '' })
    expect(o).toEqual({ vllm: { chat_template_kwargs: { enable_thinking: false } } })
  })

  it('Ollama에는 vLLM 전용 필드를 보내지 않는다', () => {
    expect(llmProviderOptions({ backend: 'ollama', baseURL: '', model: '' })).toBeUndefined()
  })

  it('OpenAI에는 reasoningEffort=none을 보낸다 (chat/completions 툴 호출 제약)', () => {
    expect(llmProviderOptions({ backend: 'openai', baseURL: '', model: '' })).toEqual({
      openai: { reasoningEffort: 'none' },
    })
  })
})

/**
 * 여기가 핵심 검증이다. providerOptions가 실제 HTTP body에 실리는지는
 * SDK 내부 동작에 달렸으므로, 목 서버로 나가는 요청을 직접 들여다본다.
 */
describe('실제 요청 body', () => {
  let server: Server | undefined

  afterAll(() => server?.close())

  const listen = (onBody: (body: unknown) => void): Promise<string> =>
    new Promise((resolve) => {
      server = createServer((req, res) => {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
          onBody(JSON.parse(raw))
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              id: 'x',
              object: 'chat.completion',
              created: 0,
              model: 'qwen3-32b-finance',
              choices: [
                { index: 0, message: { role: 'assistant', content: '네' }, finish_reason: 'stop' },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
          )
        })
      })
      server.listen(0, '127.0.0.1', () => {
        const addr = server!.address()
        resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/v1`)
      })
    })

  it('openai 백엔드는 reasoning_effort=none이 body에 담겨 나간다', async () => {
    let sent: Record<string, unknown> = {}
    const baseURL = await listen((b) => (sent = b as Record<string, unknown>))

    const config = { backend: 'openai' as const, baseURL, model: 'gpt-5.6-luna' }
    await generateText({
      model: llmModel(config),
      prompt: '안녕',
      providerOptions: llmProviderOptions(config),
    })

    expect(sent.reasoning_effort).toBe('none')
  })

  it('chat_template_kwargs.enable_thinking=false가 body에 담겨 나간다', async () => {
    let sent: Record<string, unknown> = {}
    const baseURL = await listen((b) => (sent = b as Record<string, unknown>))

    const config = { backend: 'vllm' as const, baseURL, model: 'qwen3-32b-finance' }
    await generateText({
      model: llmModel(config),
      prompt: '안녕',
      providerOptions: llmProviderOptions(config),
    })

    expect(sent.model).toBe('qwen3-32b-finance')
    expect(sent.chat_template_kwargs).toEqual({ enable_thinking: false })
  })
})
