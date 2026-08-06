/**
 * 세션 토큰 — HMAC-SHA256 서명, payload에 세션ID(sid)·사용자(sub)·워크스페이스(ws)·만료(exp).
 *
 * 미들웨어(edge 번들)가 매 요청 서명·만료만 검증한다(무상태·DB 없음).
 * 폐기(revokedAt) 확인은 DB를 아는 requireSession(guard.ts)이 한다 —
 * 민감 API는 거기를 거치므로 로그아웃 즉시 막히고, 화면 라우팅은 만료까지가 한계다.
 * 이 파일은 WebCrypto·btoa만 쓴다. node:crypto를 import하면 edge 번들이 깨진다.
 *
 * ponytail: access/refresh 이원화 대신 단일 토큰 — 원문은 쿠키에만, DB엔 SHA-256 해시.
 * 재발급 회전이 필요해지면 그때 access(단기)/refresh(회전) 둘로 쪼갠다.
 */
const SECRET = process.env.AUTH_SECRET || 'wiki-graph-dev-secret'

export const SESSION_COOKIE = 'wiki_session'

export type SessionClaims = { sid: string; sub: string; ws: string | null; exp: number }

const te = new TextEncoder()

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

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

export async function signSession(
  claims: Omit<SessionClaims, 'exp'> & { maxAgeSec: number },
): Promise<string> {
  const { maxAgeSec, ...rest } = claims
  const payload = b64url(te.encode(JSON.stringify({ ...rest, exp: Date.now() + maxAgeSec * 1000 })))
  return `${payload}.${await hmac(payload)}`
}

/** 서명·만료가 유효하면 claims, 아니면 null. */
export async function verifySession(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null
  const dot = token.lastIndexOf('.')
  if (dot < 0) return null
  const payload = token.slice(0, dot)
  if ((await hmac(payload)) !== token.slice(dot + 1)) return null
  try {
    const c = JSON.parse(fromB64url(payload)) as SessionClaims
    if (typeof c.sid !== 'string' || typeof c.sub !== 'string' || typeof c.exp !== 'number')
      return null
    if (Date.now() > c.exp) return null
    return c
  } catch {
    return null
  }
}

/** DB에 저장하는 토큰 지문 — 원문은 저장하지 않는다. */
export async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', te.encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
