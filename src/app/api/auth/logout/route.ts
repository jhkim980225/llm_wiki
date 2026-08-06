import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSession } from '@/lib/auth/guard'
import { clearSessionCookie } from '@/lib/auth/cookies'
import { audit } from '@/lib/auth/audit'

/** 현재 세션 폐기 + 쿠키 제거. */
export async function POST(req: Request) {
  const authed = await requireSession()
  if (authed) {
    await db.userSession.update({
      where: { id: authed.sessionId },
      data: { revokedAt: new Date() },
    })
    await audit({
      eventType: 'LOGOUT',
      loginId: authed.user.loginId,
      success: true,
      userId: authed.user.id,
      req,
    })
  }
  const res = NextResponse.json({ ok: true })
  clearSessionCookie(res)
  return res
}
