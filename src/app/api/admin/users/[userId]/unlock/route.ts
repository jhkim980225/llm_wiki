import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/guard'

/** 계정 잠금 해제 (관리자 전용). */
export async function POST(_: Request, { params }: { params: Promise<{ userId: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { userId } = await params
  const user = await db.user.findFirst({ where: { id: userId, deletedAt: null } })
  if (!user) return NextResponse.json({ error: 'not found' }, { status: 404 })

  await db.user.update({
    where: { id: userId },
    data: { failedLoginCount: 0, lockedUntil: null, status: 'ACTIVE' },
  })
  return NextResponse.json({ ok: true })
}
