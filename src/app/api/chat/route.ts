import { streamText } from 'ai'
import { llmModel, llmProviderOptions } from '@/lib/llm/provider'
import { requireSession } from '@/lib/auth/guard'
import { db } from '@/lib/db'

// LLM 응답이 길 수 있어 넉넉히.
export const maxDuration = 600

const MAX_MESSAGES = 50
const MAX_LEN = 8000

type ChatMessage = { role: 'user' | 'assistant'; content: string }

const titleFrom = (text: string) => {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > 40 ? t.slice(0, 40) + '…' : t || '새 대화'
}

/**
 * 일반 채팅. 위키를 건드리지 않는 순수 대화 — /ask(문서 작성)와 달리 도구가 없다.
 * 현재 붙어 있는 LLM(env의 LLM_MODEL, 지금은 gpt-5.6-luna)을 그대로 쓴다.
 *
 * body: { messages: {role,content}[], conversationId?: string }
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

  // 대화 확보(워크스페이스가 있을 때만 저장). 넘어온 conversationId는 소유권을 확인한다.
  let conversationId: string | null = null
  if (ws) {
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
      '너는 주식회사 성진 워크스페이스의 도우미다. 한국어로 간결하고 정확하게 답한다. 모르면 모른다고 한다.',
    messages,
    providerOptions: llmProviderOptions(),
    onFinish: async ({ text }) => {
      if (!conversationId || !text) return
      await db.chatMessage.create({
        data: { conversationId, role: 'assistant', content: text },
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
