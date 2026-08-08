'use client'
import { useEffect, useState } from 'react'

/**
 * slug → 개체 타입 표. 채팅·문서 챗 답변의 링크에 타입 배지를 달 때 쓴다.
 *
 * 링크마다 조회하지 않고 화면당 한 번 통째로 받는다 — 수백 행 규모라 그편이 싸고,
 * 스트리밍 중 링크가 늘어나도 추가 호출이 없다. 실패하면 배지만 안 붙는다.
 */
export function useEntityTypes(): Map<string, string> {
  const [types, setTypes] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    let stale = false
    fetch('/api/graph-ref?all=1')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((b: { items?: { pageSlug: string; type: string }[] }) => {
        if (stale) return
        setTypes(new Map((b.items ?? []).map((i) => [i.pageSlug, i.type])))
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [])

  return types
}
