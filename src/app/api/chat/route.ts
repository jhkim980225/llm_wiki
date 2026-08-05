import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from 'ai'
import { wikiTools } from '@/lib/agent/tools'
import { llmConfig, llmModel, llmProviderOptions } from '@/lib/llm/provider'

const SYSTEM = `너는 사내 위키를 편집하는 도우미다.

근거 모으기
- 사내 지식 그래프가 3개 물려 있다(이메일 온톨로지·카카오 지식그래프·승훈 온톨로지).
  query_knowledge_graph 한 번이면 셋을 동시에 조회한다. 소스마다 따로 부르지 마라.
- 결과의 각 항목에는 출처(source)가 붙어 있다. 문서를 쓸 때 어느 그래프에서 온 사실인지 밝혀라.
- 소스 하나가 실패해도 나머지 답은 온다. sources에서 ok가 false인 소스는
  "그런 사실이 없다"가 아니라 "물어보지 못했다"이다. 둘을 섞어 말하지 마라.
- 회의록·문서 본문 같은 긴 텍스트는 개체의 속성에 들어 있다.
  그 내용이 필요하면 withAttributes를 켜서 읽어라.
- 그래프에 이미 적재된 내용은 위키 문서로도 들어와 있다. wiki_search가 본문까지 뒤지므로
  회의록 내용을 찾을 때는 wiki_search가 더 빠르다. 최신 관계가 필요할 때만 그래프를 쓴다.

문서 작성
- 여러 소스에서 모은 내용은 그대로 붙이지 말고 요약해서 쓴다. 상충하면 상충한다고 적어라.
- 관련 문서가 위키에 있으면 [[slug]] 또는 [[slug|표시명]]으로 잇는다.
- 근거를 못 찾은 항목은 지어내지 말고 비워 두고 그 사실을 적어라.

편집 규칙
- 페이지를 고치기 전에 반드시 wiki_read_page로 현재 내용을 확인한다.
- 본문 일부만 바꿀 때는 wiki_write_page 대신 wiki_replace_text를 쓴다.`

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
