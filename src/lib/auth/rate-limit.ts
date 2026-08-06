/**
 * 로그인 IP rate limit — 분당 10회.
 * ponytail: 프로세스 메모리 Map. 단일 파드 PoC 기준이며 재시작하면 초기화된다.
 * 파드가 늘면 Redis 같은 공유 저장으로 옮긴다.
 */
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 10

const hits = new Map<string, { count: number; resetAt: number }>()

export function rateLimited(ip: string): boolean {
  const now = Date.now()
  const cur = hits.get(ip)
  if (!cur || now > cur.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  cur.count += 1
  return cur.count > MAX_PER_WINDOW
}

/**
 * 클라이언트 IP. X-Forwarded-For는 우리 앞단(k8s NodePort/프록시)이 신뢰 가능할 때만
 * 의미가 있다 — 첫 값을 쓰되 없으면 null.
 */
export function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for')
  return xff ? xff.split(',')[0].trim() : null
}
