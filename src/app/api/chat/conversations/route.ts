import { requireSession } from '@/lib/auth/guard'
import { db } from '@/lib/db'

/** 현재 사용자·워크스페이스의 대화 목록(최신순). */
export async function GET() {
  const authed = await requireSession()
  if (!authed) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (!authed.claims.ws) return Response.json({ conversations: [] })

  const conversations = await db.chatConversation.findMany({
    where: { userId: authed.user.id, workspaceId: authed.claims.ws },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, updatedAt: true },
    take: 100,
  })
  return Response.json({ conversations })
}
