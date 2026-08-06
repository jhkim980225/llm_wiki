import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSession } from '@/lib/auth/guard'
import { clearSessionCookie } from '@/lib/auth/cookies'
import { audit } from '@/lib/auth/audit'

/** 이 사용자의 모든 세션 폐기 (다른 기기 포함). */
export async function POST(req: Request) {
  const authed = await requireSession()
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  await db.userSession.updateMany({
    where: { userId: authed.user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  await audit({
    eventType: 'LOGOUT',
    loginId: authed.user.loginId,
    success: true,
    userId: authed.user.id,
    failureReason: 'logout-all',
    req,
  })
  const res = NextResponse.json({ ok: true })
  clearSessionCookie(res)
  return res
}
