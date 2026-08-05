import { NextResponse, type NextRequest } from 'next/server'

/**
 * 선택적 접근 게이트. `APP_PASSWORD`가 설정돼 있을 때만 동작한다.
 * 설정이 없으면 아무것도 막지 않는다 — 단일 워크스페이스 PoC의 기존(공개) 동작 유지.
 *
 * ponytail: PoC용 단일 공유 비밀번호 게이트. 쿠키에 비밀번호를 그대로 담고(httpOnly라
 * JS에서 못 읽음) 단순 비교한다. 사용자별 계정/세션이 필요해지면 그때 실제 인증으로 교체.
 */
const COOKIE = 'wiki_auth'

export function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD
  if (!password) return NextResponse.next() // 게이트 비활성 = 공개

  if (req.cookies.get(COOKIE)?.value === password) return NextResponse.next()

  const { pathname } = req.nextUrl
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  return NextResponse.redirect(url)
}

export const config = {
  // 정적 자원과 로그인 경로는 게이트에서 제외
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login|api/login).*)'],
}
