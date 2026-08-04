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
  aliases: string[]
  version: number
  updatedAt: string
  lastEditSource: string
  outLinks: string[]
  deadLinks: string[]
  backlinks: { slug: string; title: string }[]
}

const EDITOR: Record<string, string> = {
  user: '사람',
  agent: '에이전트',
  revert: '되돌림',
  ontology: '온톨로지',
}

export function PageView({ page, onEdit }: { page: PageData; onEdit: () => void }) {
  const [html, setHtml] = useState('')

  const existing = useMemo(
    () => new Set(page.outLinks.filter((s) => !page.deadLinks.includes(s))),
    [page.outLinks, page.deadLinks],
  )

  useEffect(() => {
    // 위키링크를 앵커로 바꾼 뒤 마크다운을 파싱하고, 마지막에 반드시 정화한다.
    const withLinks = wikiLinksToHtml(page.content, existing)
    Promise.resolve(marked.parse(withLinks)).then((parsed) => {
      setHtml(DOMPurify.sanitize(parsed, { ADD_ATTR: ['class'] }))
    })
  }, [page.content, existing])

  const updated = new Date(page.updatedAt).toISOString().slice(0, 10)

  return (
    <div className="doc-inner">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h1 style={{ fontSize: '2rem', margin: '0 0 4px', letterSpacing: '-0.02em', flex: 1 }}>
          {page.title}
        </h1>
        <button className="quiet" onClick={onEdit}>
          편집
        </button>
      </div>

      <div className="props">
        <div className="props-title">속성</div>

        <Row icon="≡" name="type" value={page.pageType} />

        {page.aliases.length > 0 && (
          <Row
            icon="🏷"
            name="tags"
            value={
              <>
                {page.aliases.map((a) => (
                  <span key={a} className="tag">
                    {a}
                  </span>
                ))}
              </>
            }
          />
        )}

        {page.summary && <Row icon="≣" name="summary" value={page.summary} />}
        <Row icon="📅" name="updated" value={`${updated} · v${page.version} · ${EDITOR[page.lastEditSource] ?? page.lastEditSource}`} />
        <Row icon="🔗" name="links" value={`나감 ${page.outLinks.length} · 들어옴 ${page.backlinks.length}${page.deadLinks.length ? ` · 끊김 ${page.deadLinks.length}` : ''}`} />
      </div>

      <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />

      <section className="backlinks">
        <h4>이 문서를 가리키는 문서 {page.backlinks.length}</h4>
        {page.backlinks.length === 0 ? (
          <p className="meta">없음</p>
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
    </div>
  )
}

function Row({ icon, name, value }: { icon: string; name: string; value: React.ReactNode }) {
  return (
    <div className="prop-row">
      <span className="prop-key">
        <span className="icon">{icon}</span>
        {name}
      </span>
      <span className="prop-val">{value}</span>
    </div>
  )
}
