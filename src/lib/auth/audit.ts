import { db } from '@/lib/db'

export type AuditEvent =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'ACCOUNT_LOCKED'
  | 'LOGOUT'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET'

/**
 * 로그인 감사 로그. 기록 실패가 인증 흐름을 죽이면 안 되므로 삼킨다.
 * 비밀번호·토큰은 절대 여기로 오지 않는다 — 호출부에서 넘기지 마라.
 */
export async function audit(entry: {
  eventType: AuditEvent
  loginId: string
  success: boolean
  userId?: string | null
  workspaceId?: string | null
  failureReason?: string | null
  req?: Request
}): Promise<void> {
  const { req, ...rest } = entry
  try {
    await db.loginAuditLog.create({
      data: {
        ...rest,
        ipAddress: req?.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null,
        userAgent: req?.headers.get('user-agent') ?? null,
      },
    })
  } catch (e) {
    console.error('audit log failed:', (e as Error).message)
  }
}
