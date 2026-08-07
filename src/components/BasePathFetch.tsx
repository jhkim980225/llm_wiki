'use client'

/**
 * basePath 배포에서 fetch('/api/…') 같은 루트 절대경로 호출을 살리는 전역 패치.
 * Next의 basePath는 라우터·에셋만 접두사를 붙이고 fetch는 건드리지 않는다 —
 * 호출부 40여 곳을 고치는 대신 여기 한 곳에서 접두사를 붙인다.
 * next.config.ts의 BASE_PATH와 값이 같아야 한다.
 */
const BASE = '/graphwiki'

declare global {
  interface Window {
    __basePathFetchPatched?: boolean
  }
}

if (typeof window !== 'undefined' && !window.__basePathFetchPatched) {
  window.__basePathFetchPatched = true
  const orig = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/') && !input.startsWith(`${BASE}/`)) {
      input = BASE + input
    }
    return orig(input, init)
  }
}

/** 렌더할 것은 없다 — 모듈 로드 시 패치가 걸리도록 layout에 한 번 꽂는 용도. */
export function BasePathFetch() {
  return null
}
