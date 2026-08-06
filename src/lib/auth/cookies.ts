import type { NextResponse } from 'next/server'
import { SESSION_COOKIE } from './session'

/**
 * 인증 쿠키 — HttpOnly · SameSite=Lax · 운영(https 가정)에서만 Secure.
 * '로그인 상태 유지'가 아니면 Max-Age를 빼서 브라우저 종료와 함께 사라지게 한다
 * (토큰 자체 만료는 8시간 — session.ts exp가 진짜 수명이다).
 */
export function setSessionCookie(res: NextResponse, token: string, remember: boolean, maxAgeSec: number) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(remember ? { maxAge: maxAgeSec } : {}),
  })
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
}
