import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { wikiTools } from '@/lib/agent/tools'

const provider = createOpenAICompatible({
  name: 'ollama',
  baseURL: process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1',
})

const SYSTEM = `너는 사내 위키를 편집하는 도우미다.
- 페이지를 고치기 전에 반드시 wiki_read_page로 현재 내용을 확인한다.
- 문서끼리는 [[slug]] 또는 [[slug|표시명]]으로 잇는다.
- 본문 일부만 바꿀 때는 wiki_write_page 대신 wiki_replace_text를 쓴다.
- 위키에 없는 개체·관계는 query_knowledge_graph로 확인한다.`

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  const result = streamText({
    model: provider(process.env.LLM_MODEL ?? 'qwen3:14b'),
    system: SYSTEM,
    messages: await convertToModelMessages(messages),
    tools: wikiTools,
    stopWhen: stepCountIs(12),
  })

  return result.toUIMessageStreamResponse()
}
