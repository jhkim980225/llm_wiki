import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { verifyPassword, normalizeLoginId, DUMMY_HASH } from '@/lib/auth/password'
import { signSession, tokenHash } from '@/lib/auth/session'
import { setSessionCookie } from '@/lib/auth/cookies'
import { rateLimited, clientIp } from '@/lib/auth/rate-limit'
import { audit } from '@/lib/auth/audit'

const HOUR = 60 * 60
const SESSION_SHORT = 8 * HOUR // 상태 유지 미선택
const SESSION_LONG = 30 * 24 * HOUR // 상태 유지 선택
const MAX_FAILS = 5
const LOCK_MINUTES = 10

const Body = z.object({
  loginId: z.string().min(1),
  password: z.string().min(1),
  rememberMe: z.boolean().default(false),
})

const INVALID = { code: 'INVALID_CREDENTIALS', message: '아이디 또는 비밀번호가 올바르지 않습니다.' }
const LOCKED = {
  code: 'ACCOUNT_LOCKED',
  message: '로그인 시도가 여러 번 실패하여 계정이 잠겼습니다. 잠시 후 다시 시도해 주세요.',
}

export async function POST(req: Request) {
  const ip = clientIp(req)
  if (ip && rateLimited(ip)) {
    return NextResponse.json(
      { code: 'RATE_LIMITED', message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 429 },
    )
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json(INVALID, { status: 401 })
  const loginId = normalizeLoginId(parsed.data.loginId)
  const { password, rememberMe } = parsed.data

  const user = await db.user.findFirst({ where: { loginId, deletedAt: null } })

  // 없는 아이디도 bcrypt 비교 시간을 태워 존재 여부를 시간으로 못 읽게 한다
  if (!user) {
    verifyPassword(password, DUMMY_HASH)
    await audit({ eventType: 'LOGIN_FAILED', loginId, success: false, failureReason: 'no such user', req })
    return NextResponse.json(INVALID, { status: 401 })
  }

  if (user.status === 'DISABLED') {
    await audit({ eventType: 'LOGIN_FAILED', loginId, success: false, userId: user.id, failureReason: 'disabled', req })
    return NextResponse.json(INVALID, { status: 401 })
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await audit({ eventType: 'LOGIN_FAILED', loginId, success: false, userId: user.id, failureReason: 'locked', req })
    return NextResponse.json(LOCKED, { status: 423 })
  }

  if (!verifyPassword(password, user.passwordHash)) {
    const fails = user.failedLoginCount + 1
    const lock = fails >= MAX_FAILS
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : fails,
        ...(lock
          ? { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000), status: 'LOCKED' }
          : {}),
      },
    })
    await audit({
      eventType: lock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
      loginId,
      success: false,
      userId: user.id,
      failureReason: 'wrong password',
      req,
    })
    return NextResponse.json(lock ? LOCKED : INVALID, { status: lock ? 423 : 401 })
  }

  // 성공 — 실패 카운터·잠금 해제 + 마지막 로그인 기록
  await db.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, status: 'ACTIVE', lastLoginAt: new Date() },
  })

  const memberships = await db.workspaceMember.findMany({
    where: { userId: user.id, workspace: { status: 'ACTIVE' } },
    include: { workspace: true },
    orderBy: { joinedAt: 'asc' },
  })
  const chosen = memberships.find((m) => m.isDefault) ?? (memberships.length === 1 ? memberships[0] : null)

  const maxAge = rememberMe ? SESSION_LONG : SESSION_SHORT
  const sessionId = crypto.randomUUID()
  const token = await signSession({
    sid: sessionId,
    sub: user.id,
    ws: chosen?.workspaceId ?? null,
    maxAgeSec: maxAge,
  })
  await db.userSession.create({
    data: {
      id: sessionId,
      userId: user.id,
      workspaceId: chosen?.workspaceId ?? null,
      refreshTokenHash: await tokenHash(token),
      ipAddress: ip,
      userAgent: req.headers.get('user-agent'),
      expiresAt: new Date(Date.now() + maxAge * 1000),
    },
  })

  await audit({
    eventType: 'LOGIN_SUCCESS',
    loginId,
    success: true,
    userId: user.id,
    workspaceId: chosen?.workspaceId ?? null,
    req,
  })

  const res = NextResponse.json({
    user: {
      id: user.id,
      loginId: user.loginId,
      displayName: user.displayName,
      role: chosen?.role ?? null,
      mustChangePassword: user.mustChangePassword,
    },
    workspace: chosen
      ? { id: chosen.workspace.id, name: chosen.workspace.name, slug: chosen.workspace.slug }
      : null,
    // 기본이 없고 여러 곳 소속이면 프런트가 이 목록으로 선택 UI를 띄운다
    workspaces: chosen
      ? undefined
      : memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, slug: m.workspace.slug, role: m.role })),
  })
  setSessionCookie(res, token, rememberMe, maxAge)
  return res
}
