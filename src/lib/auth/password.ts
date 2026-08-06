import bcrypt from 'bcryptjs'

/**
 * 비밀번호 해시 — bcrypt cost 12. Route Handler 전용 (미들웨어에서 import 금지).
 * bcrypt(네이티브) 대신 bcryptjs — alpine 도커 빌드에서 네이티브 컴파일이 없다.
 */
const COST = 12

/** 존재하지 않는 아이디일 때도 같은 시간을 쓰기 위한 더미 해시 ("timing-dummy"). */
export const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO7uVn4mCpNTzDcbjmGYIYpZUtOb15W7u'

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, COST)
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    return bcrypt.compareSync(password, stored)
  } catch {
    return false
  }
}

export const LOGIN_ID_RE = /^[a-zA-Z0-9._-]{4,50}$/

/** 아이디는 소문자로 정규화해 저장·조회한다 (대소문자 비구분). */
export const normalizeLoginId = (raw: string): string => raw.trim().toLowerCase()

/**
 * 비밀번호 정책 — 8자 이상 + 영문/숫자/특수문자 중 2종 이상.
 * 통과하면 null, 아니면 사용자에게 보여줄 사유.
 */
export function passwordPolicyError(password: string): string | null {
  if (password.length < 8) return '비밀번호는 8자 이상이어야 합니다.'
  const kinds =
    Number(/[a-zA-Z]/.test(password)) +
    Number(/[0-9]/.test(password)) +
    Number(/[^a-zA-Z0-9]/.test(password))
  if (kinds < 2) return '영문, 숫자, 특수문자 중 2종류 이상을 포함해야 합니다.'
  return null
}
