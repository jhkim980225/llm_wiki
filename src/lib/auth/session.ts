/**
 * 서명 세션 토큰 — HMAC-SHA256, 서버 상태 없음.
 *
 * 미들웨어(edge 번들)가 매 요청 검증하므로 이 파일은 WebCrypto·btoa만 쓴다.
 * node:crypto를 import하면 edge 번들이 깨진다 — 비밀번호 해시는 password.ts에 따로 있다.
 *
 * ponytail: 서명 비밀은 AUTH_SECRET 환경변수, 없으면 고정 문자열 — 사내망 PoC 기준.
 * 외부 노출 시 AUTH_SECRET 필수 + 비밀 교체로 전체 토큰 무효화.
 */
const SECRET = process.env.AUTH_SECRET || 'wiki-graph-dev-secret'

export const SESSION_COOKIE = 'wiki_session'

const te = new TextEncoder()

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

/** payload는 JSON.stringify 결과(ASCII)라 atob 왕복이 안전하다. */
const fromB64url = (s: string): string => atob(s.replace(/-/g, '+').replace(/_/g, '/'))

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    te.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(data))))
}

export async function signSession(userId: string, maxAgeSec: number): Promise<string> {
  const payload = b64url(te.encode(JSON.stringify({ sub: userId, exp: Date.now() + maxAgeSec * 1000 })))
  return `${payload}.${await hmac(payload)}`
}

/** 유효하면 userId, 아니면 null. 서명·만료 둘 다 본다. */
export async function verifySession(token: string | undefined): Promise<string | null> {
  if (!token) return null
  const dot = token.lastIndexOf('.')
  if (dot < 0) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if ((await hmac(payload)) !== sig) return null
  try {
    const { sub, exp } = JSON.parse(fromB64url(payload))
    if (typeof sub !== 'string' || typeof exp !== 'number' || Date.now() > exp) return null
    return sub
  } catch {
    return null
  }
}
