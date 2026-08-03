import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from 'ai'
import { wikiTools } from '@/lib/agent/tools'
import { llmConfig, llmModel, llmProviderOptions } from '@/lib/llm/provider'

const SYSTEM = `너는 사내 위키를 편집하는 도우미다.
- 페이지를 고치기 전에 반드시 wiki_read_page로 현재 내용을 확인한다.
- 문서끼리는 [[slug]] 또는 [[slug|표시명]]으로 잇는다.
- 본문 일부만 바꿀 때는 wiki_write_page 대신 wiki_replace_text를 쓴다.
- 위키에 없는 개체·관계는 query_knowledge_graph로 확인한다.`

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()
  const config = llmConfig()

  const result = streamText({
    model: llmModel(config),
    system: SYSTEM,
    messages: await convertToModelMessages(messages),
    tools: wikiTools,
    stopWhen: stepCountIs(12),
    // vLLM에 thinking 끄기를 실어 보낸다. 빼면 호출당 3~10배 느려진다.
    providerOptions: llmProviderOptions(config),
  })

  return result.toUIMessageStreamResponse()
}
