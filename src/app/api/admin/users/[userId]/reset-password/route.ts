import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/guard'
import { hashPassword, passwordPolicyError } from '@/lib/auth/password'
import { audit } from '@/lib/auth/audit'

const Body = z.object({ newPassword: z.string() })

/** 비밀번호 초기화 (관리자 전용) — 다음 로그인에서 변경을 강제하고 모든 세션을 끊는다. */
export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { userId } = await params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'newPassword required' }, { status: 400 })
  const policyError = passwordPolicyError(parsed.data.newPassword)
  if (policyError) return NextResponse.json({ error: policyError }, { status: 400 })

  const user = await db.user.findFirst({ where: { id: userId, deletedAt: null } })
  if (!user) return NextResponse.json({ error: 'not found' }, { status: 404 })

  await db.user.update({
    where: { id: userId },
    data: {
      passwordHash: hashPassword(parsed.data.newPassword),
      passwordChangedAt: new Date(),
      mustChangePassword: true,
      failedLoginCount: 0,
      lockedUntil: null,
      status: 'ACTIVE',
    },
  })
  await db.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })
  await audit({ eventType: 'PASSWORD_RESET', loginId: user.loginId, success: true, userId, req })
  return NextResponse.json({ ok: true })
}
