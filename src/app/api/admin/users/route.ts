import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/guard'
import { hashPassword, passwordPolicyError, normalizeLoginId, LOGIN_ID_RE } from '@/lib/auth/password'

const Body = z.object({
  loginId: z.string().regex(LOGIN_ID_RE, '아이디는 4~50자의 영문·숫자·._-만 허용됩니다.'),
  password: z.string(),
  displayName: z.string().default(''),
  role: z.enum(['OWNER', 'WORKSPACE_ADMIN', 'EDITOR', 'VIEWER']).default('VIEWER'),
  mustChangePassword: z.boolean().default(true),
})

/** 계정 생성 (관리자 전용) — 현재 워크스페이스 멤버로 추가하고 기본 워크스페이스로 지정한다. */
export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'invalid body' }, { status: 400 })
  }
  const policyError = passwordPolicyError(parsed.data.password)
  if (policyError) return NextResponse.json({ error: policyError }, { status: 400 })

  try {
    const user = await db.user.create({
      data: {
        loginId: normalizeLoginId(parsed.data.loginId),
        passwordHash: hashPassword(parsed.data.password),
        displayName: parsed.data.displayName,
        mustChangePassword: parsed.data.mustChangePassword,
        memberships: {
          create: { workspaceId: admin.claims.ws!, role: parsed.data.role, isDefault: true },
        },
      },
      select: { id: true, loginId: true, displayName: true, createdAt: true },
    })
    return NextResponse.json(user, { status: 201 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json({ error: '이미 존재하는 아이디입니다.' }, { status: 409 })
    }
    throw e
  }
}

/** 사용자 목록 (관리자 전용). */
export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const users = await db.user.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      loginId: true,
      displayName: true,
      status: true,
      failedLoginCount: true,
      lockedUntil: true,
      mustChangePassword: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ items: users })
}
