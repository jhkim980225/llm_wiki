import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/guard'
import { hashPassword } from '@/lib/auth/password'
import { audit } from '@/lib/auth/audit'

const Body = z.object({ newPassword: z.string() })

/** 비밀번호 초기화 (관리자 전용) — 모든 세션을 끊는다. 전화번호 뒷자리 운용이라 변경은 강제하지 않는다. */
export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { userId } = await params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'newPassword required' }, { status: 400 })
  // 초기화도 관리자 몫 — 정책 검사 없이 전화번호 뒷자리 허용 (계정 생성과 동일 방침)
  if (!parsed.data.newPassword) return NextResponse.json({ error: 'newPassword required' }, { status: 400 })

  const user = await db.user.findFirst({ where: { id: userId, deletedAt: null } })
  if (!user) return NextResponse.json({ error: 'not found' }, { status: 404 })

  await db.user.update({
    where: { id: userId },
    data: {
      passwordHash: hashPassword(parsed.data.newPassword),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
      status: 'ACTIVE',
    },
  })
  await db.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })
  await audit({ eventType: 'PASSWORD_RESET', loginId: user.loginId, success: true, userId, req })
  return NextResponse.json({ ok: true })
}
