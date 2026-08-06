import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSession } from '@/lib/auth/guard'

/** 현재 로그인 사용자 + 현재 워크스페이스. */
export async function GET() {
  const authed = await requireSession()
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const ws = authed.claims.ws
    ? await db.workspace.findUnique({
        where: { id: authed.claims.ws },
        select: { id: true, name: true, slug: true },
      })
    : null

  return NextResponse.json({
    user: {
      id: authed.user.id,
      loginId: authed.user.loginId,
      displayName: authed.user.displayName,
      mustChangePassword: authed.user.mustChangePassword,
    },
    workspace: ws,
  })
}
