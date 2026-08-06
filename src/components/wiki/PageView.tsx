'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { MoreHorizontal } from 'lucide-react'
import { wikiLinksToHtml } from '@/lib/wiki/render'
import { Menu, anchorOf, type Anchor } from '@/components/vault/Dialog'
import { useVaultAction } from '@/components/vault/actions'
import { normalizeSlug } from '@/lib/wiki/slug'

export type PageData = {
  slug: string
  title: string
  content: string
  summary: string
  pageType: string
  aliases: string[]
  version: number
  status?: string
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
  const [menu, setMenu] = useState<Anchor | null>(null)

  const router = useRouter()

  const { start, dialog, error, clearError } = useVaultAction((p, value) => {
    if (p.kind === 'page-rename') router.push(`/wiki/${normalizeSlug(value)}`)
    else if (p.kind === 'page-delete') router.push('/')
    else router.refresh()
  })

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
        <h1 className="doc-title" style={{ flex: 1 }}>{page.title}</h1>
        <button className="quiet" onClick={onEdit}>
          편집
        </button>
        <button
          className="quiet"
          aria-label="문서 메뉴"
          title="문서 메뉴"
          onClick={(e) => {
            e.stopPropagation()
            setMenu(menu ? null : anchorOf(e.currentTarget))
          }}
        >
          <MoreHorizontal size={15} />
        </button>
        {menu && (
          <Menu
            at={menu}
            onClose={() => setMenu(null)}
            items={[
              { label: '이름 바꾸기', run: () => start({ kind: 'page-rename', slug: page.slug }) },
              { label: '옮기기', run: () => start({ kind: 'page-move', slug: page.slug }) },
              { label: '삭제', danger: true, run: () => start({ kind: 'page-delete', slug: page.slug, title: page.title }) },
            ]}
          />
        )}
      </div>

      {error && (
        <p className="notice" onClick={clearError}>
          {error}
        </p>
      )}
      {dialog}

      {/* 메타데이터 행 — 카드가 아니라 구분선 사이 한 줄 (docs/design.md) */}
      <div className="meta-row">
        <span>
          <span className="k">type</span>
          <span className="v uri">{page.pageType}</span>
        </span>
        <span>
          <span className="k">updated</span>
          <span className="v">{updated} · v{page.version}</span>
        </span>
        <span>
          <span className="k">author</span>
          <span className="v">{EDITOR[page.lastEditSource] ?? page.lastEditSource}</span>
        </span>
        <span>
          <span className="k">links</span>
          <span className="v">
            나감 {page.outLinks.length} · 들어옴 {page.backlinks.length}
            {page.deadLinks.length > 0 && <> · <span className="badge-warn">끊김 {page.deadLinks.length}</span></>}
          </span>
        </span>
        {page.aliases.length > 0 && (
          <span>
            <span className="k">태그</span>
            <span className="v">{page.aliases.join(' · ')}</span>
          </span>
        )}
      </div>
      {page.summary && (
        <p style={{ margin: '-16px 0 28px', color: 'var(--text-dim)', fontSize: 13.5 }}>{page.summary}</p>
      )}

      {/* 본문 링크는 dangerouslySetInnerHTML로 뿌려서 next/link가 될 수 없다.
          클릭을 위에서 가로채 라우터로 넘긴다 — 새로고침 없이 문서를 오간다. */}
      <article className="prose" onClick={interceptLinks(router)} dangerouslySetInnerHTML={{ __html: html }} />

      <section className="backlinks" onClick={interceptLinks(router)}>
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

/**
 * 내부 문서 링크 클릭을 라우터로 넘긴다.
 * 새 탭·수정키·외부 주소는 브라우저에 그대로 맡긴다.
 */
function interceptLinks(router: ReturnType<typeof useRouter>) {
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
