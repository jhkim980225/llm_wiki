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
    <article style={{ maxWidth: '44rem' }}>
      <header className="rise" style={{ marginBottom: '1.6rem' }}>
        <p className="eyebrow">
          {page.pageType} · v{page.version}
          {page.deadLinks.length > 0 && ` · 죽은 링크 ${page.deadLinks.length}`}
        </p>
        <div className="row" style={{ alignItems: 'baseline', gap: '0.9rem' }}>
          <h1 style={{ margin: 0 }}>{page.title}</h1>
          <button className="ghost" onClick={onEdit}>
            편집
          </button>
        </div>
        {page.summary && (
          <p style={{ color: 'var(--text-dim)', margin: '0.4rem 0 0', fontSize: '1.02rem' }}>
            {page.summary}
          </p>
        )}
      </header>

      <div className="prose rise" dangerouslySetInnerHTML={{ __html: html }} />

      <section className="rise glass" style={{ marginTop: '2.5rem', padding: '1.1rem 1.3rem' }}>
        <span className="eyebrow">이 문서를 가리키는 곳 · {page.backlinks.length}</span>
        {page.backlinks.length === 0 ? (
          <p style={{ color: 'var(--text-faint)', margin: '0.6rem 0 0', fontSize: '0.9rem' }}>
            아직 없습니다. 고아 문서입니다.
          </p>
        ) : (
          <ul className="list-clean" style={{ marginTop: '0.6rem' }}>
            {page.backlinks.map((b) => (
              <li key={b.slug}>
                <a href={`/wiki/${b.slug}`}>{b.title}</a>
                <span className="meta" style={{ marginLeft: '0.5rem' }}>
                  {b.slug}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  )
}
