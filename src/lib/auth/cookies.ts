import type { NextResponse } from 'next/server'
import { SESSION_COOKIE } from './session'

/**
 * 인증 쿠키 — HttpOnly · SameSite=Lax.
 * Secure는 COOKIE_SECURE=1일 때만 — 사내 데모가 http(NodePort, TLS 없음)라
 * NODE_ENV=production 기준으로 걸면 브라우저가 쿠키를 버려 로그인이 무한 루프가 된다(실측).
 * https 앞단(인그레스/프록시)이 생기면 COOKIE_SECURE=1을 반드시 켠다.
 * '로그인 상태 유지'가 아니면 Max-Age를 빼서 브라우저 종료와 함께 사라지게 한다
 * (토큰 자체 만료는 8시간 — session.ts exp가 진짜 수명이다).
 */
export function setSessionCookie(res: NextResponse, token: string, remember: boolean, maxAgeSec: number) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    path: '/',
    ...(remember ? { maxAge: maxAgeSec } : {}),
  })
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
}
