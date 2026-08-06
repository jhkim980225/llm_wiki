import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth/password'
import { signSession, SESSION_COOKIE } from '@/lib/auth/session'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** 회원가입. 성공 시 바로 로그인 상태(1일 세션)로 만든다. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const email = String(body?.email ?? '').trim().toLowerCase()
  const name = String(body?.name ?? '').trim()
  const password = String(body?.password ?? '')

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: '이메일 형식이 올바르지 않습니다.' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 })
  }

  try {
    const user = await db.user.create({
      data: { email, name, passwordHash: hashPassword(password) },
    })
    const res = NextResponse.json({ ok: true }, { status: 201 })
    res.cookies.set(SESSION_COOKIE, await signSession(user.id, 60 * 60 * 24), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    })
    return res
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json({ error: '이미 가입된 이메일입니다.' }, { status: 409 })
    }
    throw e
  }
}
