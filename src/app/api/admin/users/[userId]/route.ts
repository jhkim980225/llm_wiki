import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/guard'

const Body = z.object({
  displayName: z.string().optional(),
  status: z.enum(['ACTIVE', 'LOCKED', 'DISABLED']).optional(),
  deleted: z.boolean().optional(),
})

/** 사용자 수정 (관리자 전용) — 표시명·상태·soft delete. */
export async function PATCH(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { userId } = await params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 })

  const user = await db.user.findFirst({ where: { id: userId, deletedAt: null } })
  if (!user) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const updated = await db.user.update({
    where: { id: userId },
    data: {
      ...(parsed.data.displayName !== undefined ? { displayName: parsed.data.displayName } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.deleted ? { deletedAt: new Date() } : {}),
    },
    select: { id: true, loginId: true, displayName: true, status: true, deletedAt: true },
  })
  // 비활성/삭제면 세션도 끊는다
  if (parsed.data.status === 'DISABLED' || parsed.data.deleted) {
    await db.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }
  return NextResponse.json(updated)
}
