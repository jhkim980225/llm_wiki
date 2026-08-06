import { requireSession } from '@/lib/auth/guard'
import { db } from '@/lib/db'

/** 소유권 확인 — 현재 사용자·워크스페이스의 대화인지. */
async function own(id: string) {
  const authed = await requireSession()
  if (!authed || !authed.claims.ws) return null
  const conv = await db.chatConversation.findFirst({
    where: { id, userId: authed.user.id, workspaceId: authed.claims.ws },
    select: { id: true },
  })
  return conv ? { authed } : null
}

/** 대화의 메시지 전체(시간순). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!(await own(id))) return Response.json({ error: 'not found' }, { status: 404 })

  const messages = await db.chatMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  })
  return Response.json({ messages })
}

/** 대화 삭제(메시지는 FK cascade로 함께 지워진다). */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!(await own(id))) return Response.json({ error: 'not found' }, { status: 404 })

  await db.chatConversation.delete({ where: { id } })
  return Response.json({ ok: true })
}
