import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword } from '@/lib/auth/password'
import { signSession, SESSION_COOKIE } from '@/lib/auth/session'

const DAY = 60 * 60 * 24

/**
 * 이메일/비밀번호 로그인. 성공하면 서명 세션 쿠키를 심는다.
 * '로그인 상태 유지'면 30일, 아니면 브라우저 세션(토큰 만료 1일).
 * 계정 존재 여부를 응답으로 구분해 주지 않는다 — 이메일 수집 방지.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const email = String(body?.email ?? '').trim().toLowerCase()
  const password = String(body?.password ?? '')
  const remember = Boolean(body?.remember)

  if (!email || !password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 })
  }

  const user = await db.user.findUnique({ where: { email } })
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: 'invalid credentials' }, { status: 401 })
  }

  const maxAge = remember ? DAY * 30 : DAY
  const res = NextResponse.json({ ok: true, name: user.name })
  res.cookies.set(SESSION_COOKIE, await signSession(user.id, maxAge), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // 유지 안 하면 Max-Age를 빼서 브라우저 종료 시 사라지게 한다
    ...(remember ? { maxAge } : {}),
  })
  return res
}
