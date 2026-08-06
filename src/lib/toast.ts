/**
 * 전역 토스트 — window CustomEvent로 발행하고 Toaster(ui)가 받아 그린다.
 * React 상태를 안 거치므로 셸 안팎(로그인 화면 포함) 어디서든 호출 가능하다.
 */
export type ToastType = 'success' | 'error' | 'info'

export const TOAST_EVENT = 'wiki:toast'

export function toast(message: string, type: ToastType = 'info'): void {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { message, type } }))
}
