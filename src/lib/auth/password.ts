import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * 비밀번호 해시 — scrypt(Node 내장). "salt:hash" hex로 저장한다.
 * Route Handler 전용. 미들웨어에서 import하면 edge 번들이 깨진다 (session.ts 참조).
 */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}
