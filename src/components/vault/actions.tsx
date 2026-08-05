'use client'
import { useState, type ReactNode } from 'react'
import { Dialog, type DialogSpec } from './Dialog'
import { normalizeSlug } from '@/lib/wiki/slug'

/** 볼트에서 시작할 수 있는 일. 트리와 문서 화면이 같은 목록을 쓴다. */
export type Pending =
  | { kind: 'folder-new'; parentId: string | null }
  | { kind: 'folder-rename'; id: string; name: string }
  | { kind: 'folder-move'; id: string }
  | { kind: 'folder-delete'; id: string; name: string }
  | { kind: 'page-new'; folderId: string | null }
  | { kind: 'page-rename'; slug: string }
  | { kind: 'page-move'; slug: string }
  | { kind: 'page-delete'; slug: string; title: string }

/** 새 문서의 기본 제목. 노션처럼 만들자마자 저장되고, 사용자가 나중에 고친다. */
export const UNTITLED = '제목을 입력하세요'

function specFor(p: Pending): DialogSpec {
  switch (p.kind) {
    case 'folder-new':
      return { mode: 'text', title: '새 폴더', label: '폴더 이름', initial: '', confirm: '만들기' }
    case 'folder-rename':
      return { mode: 'text', title: '폴더 이름 바꾸기', label: '폴더 이름', initial: p.name, confirm: '바꾸기' }
    case 'folder-move':
      return { mode: 'folder', title: '폴더 옮기기', initial: null, confirm: '옮기기' }
    case 'folder-delete':
      return { mode: 'confirm', title: '폴더 삭제', body: `"${p.name}"을 지웁니다. 안이 비어 있어야 합니다.`, confirm: '삭제', danger: true }
    case 'page-new':
      // 대화상자를 쓰지 않는다 — start()가 즉시 만든다. 여기 오면 버그다.
      throw new Error('page-new는 대화상자 없이 즉시 생성된다')
    case 'page-rename':
      return { mode: 'text', title: '문서 이름 바꾸기', label: '새 slug', initial: p.slug, confirm: '바꾸기' }
    case 'page-move':
      return { mode: 'folder', title: '문서 옮기기', initial: null, confirm: '옮기기' }
    case 'page-delete':
      return { mode: 'confirm', title: '문서 삭제', body: `"${p.title}"을 지웁니다. 이 문서를 가리키던 링크는 끊긴 링크로 남습니다.`, confirm: '삭제', danger: true }
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const enc = encodeURIComponent

/** Pending + 고른 값 → 요청 한 번. 성공이면 null, 실패면 메시지. */
async function run(p: Pending, value: string): Promise<string | null> {
  const folderId = value || null

  const res = await (() => {
    switch (p.kind) {
      case 'folder-new':
        return fetch('/api/folders', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name: value, parentId: p.parentId }) })
      case 'folder-rename':
        return fetch(`/api/folders/${p.id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ name: value }) })
      case 'folder-move':
        return fetch(`/api/folders/${p.id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ parentId: folderId }) })
      case 'folder-delete':
        return fetch(`/api/folders/${p.id}`, { method: 'DELETE' })
      case 'page-new':
        // value는 미리 만든 유일 slug. 제목은 placeholder로 저장하고 사용자가 고친다.
        return fetch('/api/pages', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ slug: normalizeSlug(value), title: UNTITLED, folderId: p.folderId }) })
      case 'page-rename':
        return fetch(`/api/pages/${enc(p.slug)}/rename`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ newSlug: value }) })
      case 'page-move':
        return fetch(`/api/pages/${enc(p.slug)}/move`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ folderId }) })
      case 'page-delete':
        return fetch(`/api/pages/${enc(p.slug)}`, { method: 'DELETE' })
    }
  })()

  if (res.ok) return null
  const body = await res.json().catch(() => ({}))
  return body.error ?? `HTTP ${res.status}`
}

/**
 * 대화상자 하나와 그 결과 처리를 묶는다.
 * onDone은 성공했을 때만 불리고, 인자는 시작한 Pending과 사용자가 고른 값이다.
 */
export function useVaultAction(onDone: (p: Pending, value: string) => void): {
  start: (p: Pending) => void
  dialog: ReactNode
  error: string | null
  clearError: () => void
} {
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)

  const confirm = async (value: string) => {
    if (!pending) return
    const failed = await run(pending, value)
    setError(failed)
    setPending(null)
    if (!failed) onDone(pending, value)
  }

  // 새 문서는 노션처럼 묻지 않고 바로 저장한다. slug는 시각 기반으로 유일하게 만든다.
  const start = (p: Pending) => {
    if (p.kind !== 'page-new') {
      setPending(p)
      return
    }
    const slug = `무제-${Date.now().toString(36)}`
    run(p, slug).then((failed) => {
      setError(failed)
      if (!failed) onDone(p, slug)
    })
  }

  return {
    start,
    error,
    clearError: () => setError(null),
    dialog: pending ? (
      <Dialog spec={specFor(pending)} onConfirm={confirm} onCancel={() => setPending(null)} />
    ) : null,
  }
}
