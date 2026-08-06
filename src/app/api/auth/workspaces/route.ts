import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSession } from '@/lib/auth/guard'

/** 내 워크스페이스 목록 — 로그인 후에만 노출한다. */
export async function GET() {
  const authed = await requireSession()
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const memberships = await db.workspaceMember.findMany({
    where: { userId: authed.user.id, workspace: { status: 'ACTIVE' } },
    include: { workspace: true },
    orderBy: { joinedAt: 'asc' },
  })
  return NextResponse.json({
    items: memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      slug: m.workspace.slug,
      role: m.role,
      isDefault: m.isDefault,
    })),
  })
}
