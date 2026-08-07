import { streamText, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import { llmModel, llmProviderOptions } from '@/lib/llm/provider'
import { requireSession } from '@/lib/auth/guard'
import { wikiTools, budgetContent } from '@/lib/agent/tools'
import { askSourceRag, hasRagApi } from '@/lib/rag/source-rag'
import { sanitizeLinkedText, relatedPagesFor } from '@/lib/rag/compose'
import { QUERY_SOURCES } from '@/lib/ontology/source'
import { db } from '@/lib/db'

// LLM 응답이 길 수 있어 넉넉히.
export const maxDuration = 600

const MAX_MESSAGES = 50
const MAX_LEN = 8000

type ChatMessage = { role: 'user' | 'assistant'; content: string }

type SourceAnswer = { source: string; ok: boolean; answer?: string; error?: string }
/** relatedPages.link는 본문에 그대로 복사할 수 있는 완성형 위키링크다 —
 *  {slug,title} 객체만 주면 모델이 목록형 답변에서 무시한다(실측: 거래처 질문 링크 0개). */
type AskResult = {
  answers: SourceAnswer[]
  relatedPages: { title: string; link: string }[]
}

/**
 * 채팅에 주는 도구 — 읽기 전용만. 위키 쓰기는 /ask(문서 작성) 경로의 일이다.
 * 소스별 전용 RAG API는 자연어 질문을 그대로 받으므로 도구 하나로 3소스를 동시에 묻는다.
 *
 * 요청마다 새로 만든다: LLM이 스텝을 돌며 같은 질문을 또 던질 수 있는데,
 * 소스 API가 호출당 수십 초라 중복 호출이 곧 낭비다. 공백 정규화한 질문을 키로
 * 요청 안에서 캐시한다(Promise를 캐시해 동시 중복 호출도 한 번만 나간다).
 */
function makeChatTools() {
  const asked = new Map<string, Promise<AskResult>>()
  return {
    wiki_search: wikiTools.wiki_search,
    wiki_semantic_search: wikiTools.wiki_semantic_search,
    wiki_read_page: wikiTools.wiki_read_page,
    ask_company_data: tool({
      description:
        '사내 데이터(이메일·카카오톡·발주 문서 지식그래프)에 자연어로 질문해 답을 받는다. ' +
        '회사 구성원·거래처·업무 내역·문서처럼 사내 사실을 물을 때 쓴다. 질문을 그대로 넘겨라. ' +
        '결과의 relatedPages[].link는 본문에 **그대로 복사해 쓰는 완성형 위키링크**다 — ' +
        '답변에서 해당 이름이 나오는 자리마다 붙여라(표시명은 |뒤를 짧게 바꿔도 된다). ' +
        '같은 질문을 다시 보내면 캐시된 같은 답이 온다 — 결과가 부족하면 질문을 바꿔서 물어라.',
      inputSchema: z.object({ question: z.string().describe('한국어 자연어 질문') }),
      execute: ({ question }) => {
        const key = question.trim().replace(/\s+/g, ' ')
        let p = asked.get(key)
        if (!p) {
          p = (async () => {
            const sources = QUERY_SOURCES.filter((s) => hasRagApi(s.id))
            const results = await Promise.all(sources.map((s) => askSourceRag(s.id, key)))
            // 실패 소스도 이름과 함께 알린다 — "그런 사실이 없다"와 "확인 못 했다"를 구분하게.
            const answers = sources.map((s, i) => ({ source: s.name, ...results[i] }))
            const related = await relatedPagesFor(
              results.filter((r) => r.ok).map((r) => r.answer).join('\n'),
            )
            const relatedPages = related.map((p) => ({
              title: p.title,
              link: `[[${p.slug}|${p.title}]]`,
            }))
            return { answers, relatedPages }
          })()
          asked.set(key, p)
        }
        return p
      },
    }),
  }
}

const titleFrom = (text: string) => {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > 40 ? t.slice(0, 40) + '…' : t || '새 대화'
}

/**
 * 일반 채팅. 위키를 고치지 않는 대화 — 도구는 읽기 전용(위키 검색·열람 + 소스 RAG API)만 준다.
 * 쓰기 도구는 /ask(문서 작성) 경로에만 있다.
 * 현재 붙어 있는 LLM(env의 LLM_MODEL, 지금은 gpt-5.6-luna)을 그대로 쓴다.
 *
 * body: { messages: {role,content}[], conversationId?: string, docSlug?: string, ephemeral?: boolean }
 * - docSlug: 문서 사이드 챗 — 해당 문서 본문을 컨텍스트로 깔아 준다
 * - ephemeral: true면 대화를 저장하지 않는다 (문서 사이드 챗이 쓴다)
 * 응답: 텍스트 스트림(assistant 델타). 헤더 X-Conversation-Id로 대화 id를 돌려준다.
 * 대화는 사용자·워크스페이스 스코프로 저장한다(워크스페이스 미선택이면 저장 없이 스트림만).
 */
export async function POST(req: Request) {
  const authed = await requireSession()
  if (!authed) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const raw = body?.messages
  if (!Array.isArray(raw) || raw.length === 0) {
    return Response.json({ error: 'messages is required' }, { status: 400 })
  }

  const messages: ChatMessage[] = raw
    .slice(-MAX_MESSAGES)
    .filter(
      (m: unknown): m is ChatMessage =>
        !!m &&
        typeof (m as ChatMessage).content === 'string' &&
        (m as ChatMessage).content.length <= MAX_LEN &&
        ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant'),
    )
    .map((m) => ({ role: m.role, content: m.content }))

  if (messages.length === 0) {
    return Response.json({ error: 'no valid messages' }, { status: 400 })
  }

  const ws = authed.claims.ws
  const userId = authed.user.id
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')

  // 문서 사이드 챗 — 문서 본문을 컨텍스트로 깐다. 긴 문서는 READ_BUDGET으로 자른다.
  let docContext = ''
  if (typeof body?.docSlug === 'string' && body.docSlug) {
    const doc = await db.page.findFirst({
      where: { slug: body.docSlug, deletedAt: null },
      select: { slug: true, title: true, content: true },
    })
    if (!doc) return Response.json({ error: `page not found: ${body.docSlug}` }, { status: 400 })
    const { text, truncated } = budgetContent(doc.content)
    docContext =
      `\n\n사용자가 지금 보고 있는 문서 「${doc.title}」([[${doc.slug}]]) 본문:\n${text}` +
      (truncated ? '\n(본문이 길어 앞부분만 실었다)' : '') +
      '\n\n질문이 이 문서에 관한 것이면 위 본문을 근거로 답하라.'
  }

  // 대화 확보(워크스페이스가 있을 때만 저장). 넘어온 conversationId는 소유권을 확인한다.
  // ephemeral(문서 사이드 챗)은 통째로 건너뛴다 — conversationId가 null로 남아 저장도 스킵된다.
  let conversationId: string | null = null
  if (ws && body?.ephemeral !== true) {
    if (typeof body?.conversationId === 'string') {
      const conv = await db.chatConversation.findFirst({
        where: { id: body.conversationId, userId, workspaceId: ws },
        select: { id: true },
      })
      conversationId = conv?.id ?? null
    }
    if (!conversationId) {
      const conv = await db.chatConversation.create({
        data: { userId, workspaceId: ws, title: titleFrom(lastUser?.content ?? '') },
        select: { id: true },
      })
      conversationId = conv.id
    }
    if (lastUser) {
      await db.chatMessage.create({
        data: { conversationId, role: 'user', content: lastUser.content },
      })
    }
  }

  const result = streamText({
    model: llmModel(),
    system:
      '너는 주식회사 성진 워크스페이스의 도우미다. 한국어로 간결하고 정확하게 답한다.\n' +
      '- 회사 구성원·거래처·업무 내역·사내 문서 등 사내 사실을 물으면 반드시 도구로 먼저 찾아라.\n' +
      '  ask_company_data에 질문을 그대로 넘기고, 위키 문서는 wiki_search·wiki_semantic_search로 찾아 wiki_read_page로 읽는다.\n' +
      '- 여러 소스에서 온 결과를 소스별·날짜별로 나열하지 마라. 주제 단위로 통합해 하나의 답으로 정리한다.\n' +
      '  본문에 [카카오톡], [이메일] 같은 소스 표기도 넣지 마라 — 출처는 링크가 보여준다.\n' +
      '- 사내 사실 항목마다 근거 문서를 [[slug|짧은 표시명]] 형태로 링크하라. slug는 도구 결과의\n' +
      '  relatedPages나 wiki_search 결과에 있는 것을 **그대로 복사**한다. 목록에 없는 slug를\n' +
      '  만들어내지 마라 — 죽은 링크가 된다. 근거 문서를 못 찾은 항목은 링크 없이 둔다.\n' +
      '- relatedPages에 답변 속 문서·거래처·개체와 이름이 맞는 항목이 있으면 **빠짐없이** 그 자리에\n' +
      '  링크한다. 링크와 표시명이 가리키는 대상이 같아야 한다 — 다른 금액·날짜 문서에 걸지 마라.\n' +
      '- 도구가 준 근거에 없는 사내 사실은 지어내지 마라. 조회 실패는 "확인하지 못했다"고 말한다.\n' +
      '- 일반 지식·글쓰기 요청은 도구 없이 바로 답한다.' +
      docContext,
    messages,
    tools: makeChatTools(),
    stopWhen: stepCountIs(6),
    providerOptions: llmProviderOptions(),
    onFinish: async ({ text }) => {
      if (!conversationId || !text) return
      // 지어낸 [[링크]]는 저장 전에 평문으로 강등한다 — 재열람 화면이 항상 깨끗하게.
      await db.chatMessage.create({
        data: { conversationId, role: 'assistant', content: await sanitizeLinkedText(text) },
      })
      await db.chatConversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      })
    },
  })

  const res = result.toTextStreamResponse()
  if (conversationId) res.headers.set('X-Conversation-Id', conversationId)
  return res
}
