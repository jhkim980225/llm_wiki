'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { wikiLinksToHtml } from '@/lib/wiki/render'
import { parseOutLinks } from '@/lib/wiki/links'

/**
 * 위키링크 + 마크다운 렌더 파이프라인. 문서 본문(PageView)과 채팅 답변이 같이 쓴다.
 * [[링크]]를 앵커로 바꾼 뒤 마크다운을 파싱하고, 마지막에 반드시 정화한다.
 *
 * existingSlugs가 없으면 본문에 등장하는 링크를 전부 실존으로 낙관 렌더한다 —
 * 채팅 스트림용. 죽은 링크는 저장 시 서버가 평문으로 강등하고, 그 전에 클릭해도
 * "문서 없음 + 만들기" 화면이 받아 준다.
 */
export function Markdown({ content, existingSlugs }: { content: string; existingSlugs?: Set<string> }) {
  const [html, setHtml] = useState('')
  const router = useRouter()

  const existing = useMemo(
    () => existingSlugs ?? new Set(parseOutLinks(content)),
    [existingSlugs, content],
  )

  useEffect(() => {
    const withLinks = wikiLinksToHtml(content, existing)
    Promise.resolve(marked.parse(withLinks)).then((parsed) => {
      setHtml(DOMPurify.sanitize(parsed, { ADD_ATTR: ['class'] }))
    })
  }, [content, existing])

  return <article className="prose" onClick={interceptLinks(router)} dangerouslySetInnerHTML={{ __html: html }} />
}

/**
 * 내부 문서 링크 클릭을 라우터로 넘긴다.
 * 새 탭·수정키·외부 주소는 브라우저에 그대로 맡긴다.
 */
export function interceptLinks(router: ReturnType<typeof useRouter>) {
  return (e: React.MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    if (a.target === '_blank') return
    const href = a.getAttribute('href') ?? ''
    if (!href.startsWith('/')) return
    e.preventDefault()
    router.push(href)
  }
}
