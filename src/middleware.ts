import { NextResponse, type NextRequest } from 'next/server'
import { verifySession, SESSION_COOKIE } from '@/lib/auth/session'

/**
 * 계정 인증 게이트. 서명 세션 쿠키(wiki_session)가 유효해야 통과한다.
 * 검증은 서버 상태 없는 HMAC — 매 요청 DB를 치지 않는다.
 * 로그인·가입 경로와 정적 자원만 열려 있다 (matcher).
 */
export async function middleware(req: NextRequest) {
  const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value)
  if (claims) return NextResponse.next()

  const { pathname } = req.nextUrl
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  return NextResponse.redirect(url)
}

export const config = {
  // 루트 '/'는 아래 패턴에 안 걸린다(그룹이 빈 문자열이면 미매치) — 명시적으로 추가.
  matcher: ['/', '/((?!_next/static|_next/image|favicon.ico|icon.svg|login|api/auth/login|api/health|api/flow/tick).*)'],
}
