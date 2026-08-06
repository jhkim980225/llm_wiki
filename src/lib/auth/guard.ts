import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { verifySession, tokenHash, SESSION_COOKIE, type SessionClaims } from './session'

export type AuthedSession = {
  claims: SessionClaims
  user: { id: string; loginId: string; displayName: string; status: string; mustChangePassword: boolean }
  sessionId: string
}

/**
 * Route Handler용 인증 가드 — 서명·만료(무상태) 위에 DB 확인을 얹는다:
 * 세션 폐기(revokedAt)·만료, 사용자 삭제·비활성. 미들웨어가 못 보는 것들이다.
 * 통과하면 lastUsedAt을 갱신한다.
 */
export async function requireSession(): Promise<AuthedSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const claims = await verifySession(token)
  if (!claims || !token) return null

  const session = await db.userSession.findUnique({ where: { refreshTokenHash: await tokenHash(token) } })
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null

  const user = await db.user.findFirst({
    where: { id: claims.sub, deletedAt: null, status: { not: 'DISABLED' } },
    select: { id: true, loginId: true, displayName: true, status: true, mustChangePassword: true },
  })
  if (!user) return null

  // 장부성 갱신 — 실패해도 요청을 막지 않는다
  db.userSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } }).catch(() => {})

  return { claims, user, sessionId: session.id }
}

/** 현재 워크스페이스에서 관리자(OWNER·WORKSPACE_ADMIN)인지까지 요구한다. */
export async function requireAdmin(): Promise<AuthedSession | null> {
  const authed = await requireSession()
  if (!authed) return null
  if (!authed.claims.ws) return null
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: authed.claims.ws, userId: authed.user.id } },
  })
  if (!member || !['OWNER', 'WORKSPACE_ADMIN'].includes(member.role)) return null
  return authed
}
