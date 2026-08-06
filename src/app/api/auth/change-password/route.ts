import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireSession } from '@/lib/auth/guard'
import { hashPassword, verifyPassword, passwordPolicyError } from '@/lib/auth/password'
import { audit } from '@/lib/auth/audit'

const Body = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) })

/** 비밀번호 변경 — 현재 비밀번호 확인 후 교체. 다른 세션은 전부 폐기한다. */
export async function POST(req: Request) {
  const authed = await requireSession()
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'currentPassword and newPassword are required' }, { status: 400 })
  }

  const user = await db.user.findUnique({ where: { id: authed.user.id } })
  if (!user || !verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
    return NextResponse.json({ error: '현재 비밀번호가 올바르지 않습니다.' }, { status: 401 })
  }
  const policyError = passwordPolicyError(parsed.data.newPassword)
  if (policyError) return NextResponse.json({ error: policyError }, { status: 400 })

  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPassword(parsed.data.newPassword),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
    },
  })
  // 비밀번호가 바뀌면 현재 세션만 남기고 전부 끊는다
  await db.userSession.updateMany({
    where: { userId: user.id, revokedAt: null, id: { not: authed.sessionId } },
    data: { revokedAt: new Date() },
  })
  await audit({ eventType: 'PASSWORD_CHANGED', loginId: user.loginId, success: true, userId: user.id, req })
  return NextResponse.json({ ok: true })
}
