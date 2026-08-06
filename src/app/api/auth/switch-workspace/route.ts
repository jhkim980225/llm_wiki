import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireSession } from '@/lib/auth/guard'
import { signSession, tokenHash } from '@/lib/auth/session'
import { setSessionCookie } from '@/lib/auth/cookies'

const Body = z.object({ workspaceId: z.string().uuid() })

/**
 * 워크스페이스 전환 — 소속 확인 후 현재 세션의 워크스페이스를 바꾼다.
 * 토큰에 ws가 박혀 있으므로 재서명하고 세션 행의 해시도 갱신한다.
 */
export async function POST(req: Request) {
  const authed = await requireSession()
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })

  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: parsed.data.workspaceId, userId: authed.user.id } },
    include: { workspace: true },
  })
  if (!member || member.workspace.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'not a member' }, { status: 403 })
  }

  const remainMs = authed.claims.exp - Date.now()
  const token = await signSession({
    sid: authed.sessionId,
    sub: authed.user.id,
    ws: member.workspaceId,
    maxAgeSec: Math.max(60, Math.floor(remainMs / 1000)),
  })
  await db.userSession.update({
    where: { id: authed.sessionId },
    data: { workspaceId: member.workspaceId, refreshTokenHash: await tokenHash(token) },
  })

  const res = NextResponse.json({
    workspace: { id: member.workspace.id, name: member.workspace.name, slug: member.workspace.slug },
    role: member.role,
  })
  setSessionCookie(res, token, true, Math.floor(remainMs / 1000))
  return res
}
