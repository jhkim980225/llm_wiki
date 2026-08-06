import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/guard'

const MAX_LIMIT = 200

/** 로그인 감사 로그 조회 (관리자 전용). ?loginId= 필터, ?limit= (기본 50). */
export async function GET(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const u = new URL(req.url)
  const loginId = u.searchParams.get('loginId')
  const limit = Math.min(Number(u.searchParams.get('limit')) || 50, MAX_LIMIT)

  const items = await db.loginAuditLog.findMany({
    where: loginId ? { loginId } : {},
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  // BigInt id는 JSON 직렬화가 안 된다 — 문자열로
  return NextResponse.json({ items: items.map((r) => ({ ...r, id: String(r.id) })) })
}
