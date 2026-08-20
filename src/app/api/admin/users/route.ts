import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/guard'
import { hashPassword, normalizeLoginId, LOGIN_ID_RE } from '@/lib/auth/password'

const Body = z.object({
  loginId: z.string().regex(LOGIN_ID_RE, '아이디는 4~50자의 영문·숫자·._-만 허용됩니다.'),
  password: z.string(),
  displayName: z.string().default(''),
  role: z.enum(['OWNER', 'WORKSPACE_ADMIN', 'EDITOR', 'VIEWER']).default('VIEWER'),
  // 초기 비밀번호를 전화번호 뒷자리로 계속 쓰는 운영 방침 — 변경을 강제하지 않는다 (2026-08-20)
  mustChangePassword: z.boolean().default(false),
})

/** 계정 생성 (관리자 전용) — 현재 워크스페이스 멤버로 추가하고 기본 워크스페이스로 지정한다. */
export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'invalid body' }, { status: 400 })
  }
  // 관리자가 정하는 초기 비밀번호는 정책 검사를 안 탄다 — 전화번호 뒷자리(숫자만) 허용.
  // 사용자가 스스로 바꿀 때(/api/auth/change-password)는 여전히 정책이 적용된다.
  if (!parsed.data.password) return NextResponse.json({ error: '비밀번호가 비었습니다.' }, { status: 400 })

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
