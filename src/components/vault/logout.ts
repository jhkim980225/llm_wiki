import { toast } from '@/lib/toast'

/** 세션 폐기 후 로그인 화면으로. 설정 모달·사이드바가 같이 쓴다. */
export async function logout() {
  const res = await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
  if (!res?.ok) {
    toast('로그아웃 요청이 실패했습니다 — 네트워크를 확인하세요.', 'error')
    return
  }
  toast('로그아웃했습니다.', 'success')
  // 라우터 대신 전체 리로드 — 클라이언트 상태를 확실히 비운다
  window.location.href = '/login'
}
