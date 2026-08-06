import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password'
import { signSession, verifySession } from './session'

describe('비밀번호 해시', () => {
  it('같은 비밀번호는 통과, 다른 비밀번호는 거부', () => {
    const stored = hashPassword('secret-1234')
    expect(verifyPassword('secret-1234', stored)).toBe(true)
    expect(verifyPassword('wrong', stored)).toBe(false)
  })

  it('솔트가 달라 같은 비밀번호라도 저장값이 다르다', () => {
    expect(hashPassword('x')).not.toBe(hashPassword('x'))
  })

  it('깨진 저장값은 거부', () => {
    expect(verifyPassword('x', 'not-a-hash')).toBe(false)
  })
})

describe('세션 토큰', () => {
  it('서명·검증 왕복', async () => {
    const token = await signSession('user-1', 3600)
    expect(await verifySession(token)).toBe('user-1')
  })

  it('변조된 토큰은 거부', async () => {
    const token = await signSession('user-1', 3600)
    expect(await verifySession(token.slice(0, -2) + 'xx')).toBeNull()
    // payload를 바꿔치기해도 서명이 안 맞아야 한다
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', exp: Date.now() + 9e9 }))
      .toString('base64url')
    expect(await verifySession(`${forged}.${token.split('.')[1]}`)).toBeNull()
  })

  it('만료된 토큰은 거부', async () => {
    const token = await signSession('user-1', -1)
    expect(await verifySession(token)).toBeNull()
  })

  it('빈 값·형식 오류는 null', async () => {
    expect(await verifySession(undefined)).toBeNull()
    expect(await verifySession('garbage')).toBeNull()
  })
})
