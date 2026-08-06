import { describe, expect, it } from 'vitest'
import {
  hashPassword,
  verifyPassword,
  passwordPolicyError,
  normalizeLoginId,
  LOGIN_ID_RE,
  DUMMY_HASH,
} from './password'
import { signSession, verifySession, tokenHash } from './session'

describe('비밀번호 해시 (bcrypt)', () => {
  it('같은 비밀번호는 통과, 다른 비밀번호는 거부', () => {
    const stored = hashPassword('secret-1234')
    expect(stored.startsWith('$2')).toBe(true)
    expect(verifyPassword('secret-1234', stored)).toBe(true)
    expect(verifyPassword('wrong', stored)).toBe(false)
  })

  it('깨진 저장값·더미 해시는 거부', () => {
    expect(verifyPassword('x', 'not-a-hash')).toBe(false)
    expect(verifyPassword('anything', DUMMY_HASH)).toBe(false)
  })
})

describe('아이디·비밀번호 정책', () => {
  it('loginId 규칙 — 4~50자 영문·숫자·._-', () => {
    expect(LOGIN_ID_RE.test('test')).toBe(true)
    expect(LOGIN_ID_RE.test('a.b_c-1')).toBe(true)
    expect(LOGIN_ID_RE.test('abc')).toBe(false) // 3자
    expect(LOGIN_ID_RE.test('한글아이디')).toBe(false)
    expect(LOGIN_ID_RE.test('has space')).toBe(false)
  })

  it('loginId는 소문자로 정규화한다', () => {
    expect(normalizeLoginId('  TestUser ')).toBe('testuser')
  })

  it('비밀번호 정책 — 8자 + 2종 이상', () => {
    expect(passwordPolicyError('short1')).not.toBeNull()
    expect(passwordPolicyError('onlyletters')).not.toBeNull()
    expect(passwordPolicyError('letters123')).toBeNull()
    expect(passwordPolicyError('letters!@#')).toBeNull()
  })
})

describe('세션 토큰', () => {
  const claims = { sid: 'sess-1', sub: 'user-1', ws: 'ws-1' }

  it('서명·검증 왕복 — sid·sub·ws 보존', async () => {
    const token = await signSession({ ...claims, maxAgeSec: 3600 })
    const out = await verifySession(token)
    expect(out?.sid).toBe('sess-1')
    expect(out?.sub).toBe('user-1')
    expect(out?.ws).toBe('ws-1')
  })

  it('변조된 토큰은 거부', async () => {
    const token = await signSession({ ...claims, maxAgeSec: 3600 })
    expect(await verifySession(token.slice(0, -2) + 'xx')).toBeNull()
  })

  it('만료된 토큰은 거부', async () => {
    const token = await signSession({ ...claims, maxAgeSec: -1 })
    expect(await verifySession(token)).toBeNull()
  })

  it('빈 값·형식 오류는 null', async () => {
    expect(await verifySession(undefined)).toBeNull()
    expect(await verifySession('garbage')).toBeNull()
  })

  it('tokenHash는 SHA-256 hex — 원문과 다르고 결정적', async () => {
    const token = await signSession({ ...claims, maxAgeSec: 60 })
    const h = await tokenHash(token)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).toBe(await tokenHash(token))
    expect(h).not.toContain(token)
  })
})
