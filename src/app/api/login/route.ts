import { NextResponse } from 'next/server'

const COOKIE = 'wiki_auth'

/**
 * 공유 비밀번호 확인 후 세션 쿠키를 심는다. `APP_PASSWORD`가 없으면 게이트가 꺼진
 * 상태이므로 그냥 통과시킨다.
 */
export async function POST(req: Request) {
  const password = process.env.APP_PASSWORD
  if (!password) return NextResponse.json({ ok: true })

  const body = await req.json().catch(() => ({}))
  if (body?.password !== password) {
    return NextResponse.json({ error: 'wrong password' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE, password, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30일
  })
  return res
}
