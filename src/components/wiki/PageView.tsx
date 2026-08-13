'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { Markdown, interceptLinks } from '@/components/wiki/Markdown'
import { Menu, anchorOf, type Anchor } from '@/components/vault/Dialog'
import { useVaultAction } from '@/components/vault/actions'
import { normalizeSlug } from '@/lib/wiki/slug'
import { summarizeEntity } from '@/lib/wiki/entity-summary'

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
  /** 상한(200)까지만 온다. 총수는 backlinkTotal. */
  backlinks: { slug: string; title: string }[]
  backlinkTotal: number
  /** 본문 링크 중 그래프 개체 — 링크에 타입 배지(인물·조직…)를 단다. */
  entityLinks?: { slug: string; type: string }[]
  /** 적재본 열람 시점 요약(캐시). 없으면 화면이 만들어 달라고 부른다. */
  brief?: string | null
  /** 요약을 새로 만들어야 하는가(없거나 본문이 바뀜). 판정은 서버가 한다. */
  briefStale?: boolean
}

const EDITOR: Record<string, string> = {
  user: '사람',
  agent: '에이전트',
  revert: '되돌림',
  ontology: '온톨로지',
}

export function PageView({ page, onEdit }: { page: PageData; onEdit: () => void }) {
  const [menu, setMenu] = useState<Anchor | null>(null)

  const router = useRouter()

  const { start, dialog, error, clearError } = useVaultAction((p, value) => {
    if (p.kind === 'page-rename') router.push(`/wiki/${normalizeSlug(value)}`)
    else if (p.kind === 'page-delete') router.push('/')
    else router.refresh()
  })

  // includes()로 걸렀더니 적재 개체(링크 6천 개)에서 N×M 비교가 됐다 — Set으로.
  const existing = useMemo(() => {
    const dead = new Set(page.deadLinks)
    return new Set(page.outLinks.filter((s) => !dead.has(s)))
  }, [page.outLinks, page.deadLinks])

  const entityTypes = useMemo(
    () => new Map((page.entityLinks ?? []).map((e) => [e.slug, e.type])),
    [page.entityLinks],
  )

  // 적재 개체는 관계를 전부 나열해서(값 노드 포함) 링크가 100개씩 달린다.
  // 무엇이 중요한지 먼저 보이게 위에 추린 카드를 얹는다. 본문은 그대로 둔다.
  const summary = useMemo(
    () => (page.pageType === 'entity' ? summarizeEntity(page.content) : []),
    [page.pageType, page.content],
  )

  // 적재본 요약은 **열었을 때** 만든다 — 18만 건을 미리 만들 수는 없다.
  // 캐시가 있으면 그대로 쓰고, 없거나 본문이 바뀌었을 때만 서버에 만들어 달라고 한다.
  const [brief, setBrief] = useState<string | null>(page.brief ?? null)
  const [briefBusy, setBriefBusy] = useState(false)

  useEffect(() => {
    setBrief(page.brief ?? null)
    if (!page.briefStale) return
    let stale = false
    setBriefBusy(true)
    fetch(`/api/pages/${encodeURIComponent(page.slug)}/brief`, { method: 'POST' })
      .then((r) => r.json())
      .then((d) => !stale && d?.brief && setBrief(d.brief))
      .catch(() => {})
      .finally(() => !stale && setBriefBusy(false))
    return () => {
      stale = true
    }
  }, [page.slug, page.brief, page.briefStale])

  // Delete 키로 휴지통 이동(확인 대화상자 경유). 검색창 등 입력 중에는 무시한다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete') return
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
      start({ kind: 'page-delete', slug: page.slug, title: page.title })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.slug, page.title])

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
            나감 {page.outLinks.length} · 들어옴 {page.backlinkTotal}
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
        <p style={{ margin: '-16px 0 28px', color: 'var(--text-dim)', fontSize: 13.5 }}>
          {/* 요약은 평문 표시라 위키링크 문법이 그대로 노출된다(AI 작성 요약 실측) — 표시명만 남긴다 */}
          {page.summary.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, s, d) => d ?? s)}
        </p>
      )}

      {(brief || briefBusy) && (
        <section className="doc-brief">
          <h4>요약</h4>
          {brief ? <p>{brief}</p> : <p className="wait">요약을 만드는 중…</p>}
        </section>
      )}

      {summary.length > 0 && (
        <section className="entity-summary" onClick={interceptLinks(router)}>
          {summary.map((g) => (
            <div className="row" key={`${g.dir}-${g.rel}`}>
              <span className="k">
                {g.rel}
                {g.dir === 'in' && <i title="이 문서를 가리키는 관계">←</i>}
              </span>
              <span className="v">
                {g.links.map((l) => (
                  <a key={l.slug} href={`/wiki/${l.slug}`}>
                    {l.label}
                  </a>
                ))}
                {g.total > g.links.length && <em>외 {g.total - g.links.length}개</em>}
              </span>
            </div>
          ))}
        </section>
      )}

      {/* 본문 링크는 dangerouslySetInnerHTML로 뿌려서 next/link가 될 수 없다.
          Markdown 안의 클릭 인터셉터가 라우터로 넘긴다 — 새로고침 없이 문서를 오간다. */}
      <Markdown content={page.content} existingSlugs={existing} entityTypes={entityTypes} />

      {/* 적재본은 백링크가 수백~수천 건이라(실측 660) 펼쳐 두면 본문 끝이 목록으로 덮인다.
          본문의 '참고'·'이 문서를 가리키는 관계'와 같이 기본은 접어 둔다. */}
      <details className="backlinks" onClick={interceptLinks(router)}>
        <summary>이 문서를 가리키는 문서 {page.backlinkTotal}</summary>
        {page.backlinks.length === 0 ? (
          <p className="meta">없음</p>
        ) : (
          <>
            <ul>
              {page.backlinks.map((b) => (
                <li key={b.slug}>
                  <a href={`/wiki/${b.slug}`}>{b.title}</a>
                </li>
              ))}
            </ul>
            {page.backlinkTotal > page.backlinks.length && (
              <p className="meta">…외 {page.backlinkTotal - page.backlinks.length}개</p>
            )}
          </>
        )}
      </details>
    </div>
  )
}
