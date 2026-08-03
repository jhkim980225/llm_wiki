'use client'
import { useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { wikiLinksToHtml } from '@/lib/wiki/render'

export type PageData = {
  slug: string
  title: string
  content: string
  summary: string
  pageType: string
  version: number
  outLinks: string[]
  deadLinks: string[]
  backlinks: { slug: string; title: string }[]
}

export function PageView({ page, onEdit }: { page: PageData; onEdit: () => void }) {
  const [html, setHtml] = useState('')

  const existing = useMemo(
    () => new Set(page.outLinks.filter((s) => !page.deadLinks.includes(s))),
    [page.outLinks, page.deadLinks],
  )

  useEffect(() => {
    // 위키링크를 먼저 앵커로 바꾸고 마크다운을 파싱한 뒤, 마지막에 반드시 정화한다.
    const withLinks = wikiLinksToHtml(page.content, existing)
    Promise.resolve(marked.parse(withLinks)).then((parsed) => {
      setHtml(DOMPurify.sanitize(parsed, { ADD_ATTR: ['class'] }))
    })
  }, [page.content, existing])

  return (
    <article style={{ maxWidth: 760 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ margin: 0 }}>{page.title}</h1>
        <span style={{ color: '#5f6368' }}>
          {page.pageType} · v{page.version}
        </span>
        <button onClick={onEdit}>편집</button>
      </header>

      {page.summary && <p style={{ color: '#5f6368' }}>{page.summary}</p>}

      <div className="wiki-body" dangerouslySetInnerHTML={{ __html: html }} />

      <section style={{ marginTop: 32, borderTop: '1px solid #e0e0e0', paddingTop: 12 }}>
        <h3>백링크 ({page.backlinks.length})</h3>
        {page.backlinks.length === 0 ? (
          <p style={{ color: '#5f6368' }}>이 페이지를 가리키는 문서가 없습니다.</p>
        ) : (
          <ul>
            {page.backlinks.map((b) => (
              <li key={b.slug}>
                <a href={`/wiki/${b.slug}`}>{b.title}</a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <style>{`
        .wiki-body a.wikilink { color: #1a73e8; text-decoration: none; }
        .wiki-body a.wikilink.dead { color: #c5221f; border-bottom: 1px dashed #c5221f; }
        .wiki-body pre { background: #f6f8fa; padding: 12px; overflow-x: auto; }
      `}</style>
    </article>
  )
}
