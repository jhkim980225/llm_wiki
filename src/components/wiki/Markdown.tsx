'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { ExternalLink, X } from 'lucide-react'
import { wikiLinksToHtml } from '@/lib/wiki/render'
import { parseOutLinks } from '@/lib/wiki/links'

/** 미리보기 팝오버에 띄울 문서 요약. */
type Preview = {
  slug: string
  title: string
  summary: string
  /** '## 속성' 표에서 뽑은 핵심 키-값 (개체 문서의 실질 요약) */
  rows: [string, string][]
  /** 속성이 없을 때 보여줄 본문 앞부분 발췌 */
  excerpt: string
}

/** slug 접두사 → 출처 라벨 (온톨로지 적재 규칙). */
function sourceLabel(slug: string): string | null {
  if (slug.startsWith('ejkim/')) return '이메일'
  if (slug.startsWith('kakao/')) return '카톡'
  if (slug.startsWith('seunghoon/')) return '문서'
  return null
}

/** 문서 본문에서 속성 표와 발췌를 뽑는다 — LLM 없이 즉시 뜨는 요약. */
function digest(content: string): { rows: [string, string][]; excerpt: string } {
  const rows: [string, string][] = []
  const lines = content.split('\n')
  let inAttrs = false
  for (const ln of lines) {
    if (ln.startsWith('## ')) inAttrs = ln.startsWith('## 속성')
    else if (inAttrs && ln.startsWith('|') && !ln.includes('---')) {
      const cells = ln.split('|').map((c) => c.trim()).filter(Boolean)
      if (cells.length >= 2 && cells[0] !== '항목') rows.push([cells[0], cells[1].slice(0, 200)])
      if (rows.length >= 8) break
    }
  }
  const excerpt = content
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, s, d) => d || s)
    .replace(/[#`*_>|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)
  return { rows, excerpt }
}

/**
 * 위키링크 + 마크다운 렌더 파이프라인. 문서 본문(PageView)과 채팅 답변이 같이 쓴다.
 * [[링크]]를 앵커로 바꾼 뒤 마크다운을 파싱하고, 마지막에 반드시 정화한다.
 *
 * existingSlugs가 없으면 본문에 등장하는 링크를 전부 실존으로 낙관 렌더한다(채팅 스트림용).
 * preview가 켜지면 링크 클릭 시 바로 이동하지 않고 요약 팝오버를 먼저 띄운다 —
 * 출처가 원문 덤프로 바로 떨어져 "무엇을 참조했는지 모르겠다"는 문제의 해법.
 */
export function Markdown({
  content,
  existingSlugs,
  preview = false,
}: {
  content: string
  existingSlugs?: Set<string>
  preview?: boolean
}) {
  const [html, setHtml] = useState('')
  const [pv, setPv] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
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

  const openPreview = async (slug: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/pages/${encodeURIComponent(slug)}`)
      if (!res.ok) {
        router.push(`/wiki/${slug}`)
        return
      }
      const p = await res.json()
      setPv({ slug, title: p.title, summary: p.summary ?? '', ...digest(p.content ?? '') })
    } finally {
      setLoading(false)
    }
  }

  const onClick = (e: React.MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    if (a.target === '_blank') return
    const href = a.getAttribute('href') ?? ''
    if (!href.startsWith('/')) return
    e.preventDefault()
    if (preview && a.classList.contains('wikilink') && href.startsWith('/wiki/')) {
      openPreview(decodeURIComponent(href.slice('/wiki/'.length)))
    } else {
      router.push(href)
    }
  }

  return (
    <>
      <article className="prose" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
      {loading && <p className="meta">출처 여는 중…</p>}
      {pv && (
        <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && setPv(null)}>
          <div className="modal-card link-preview">
            <div className="head">
              <h3 style={{ margin: 0 }}>{pv.title}</h3>
              {sourceLabel(pv.slug) && <span className="src">{sourceLabel(pv.slug)}</span>}
              <span className="grow" />
              <button className="icon" aria-label="닫기" onClick={() => setPv(null)}>
                <X size={14} />
              </button>
            </div>
            {pv.summary && <p className="meta" style={{ margin: '2px 0 8px' }}>{pv.summary}</p>}
            {pv.rows.length > 0 ? (
              <dl className="attrs">
                {pv.rows.map(([k, v]) => (
                  <div key={k + v}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="excerpt">{pv.excerpt || '내용이 없는 문서입니다.'}</p>
            )}
            <div className="buttons">
              <button className="quiet" onClick={() => setPv(null)}>
                닫기
              </button>
              <button
                className="primary"
                onClick={() => {
                  setPv(null)
                  router.push(`/wiki/${pv.slug}`)
                }}
              >
                <ExternalLink size={13} aria-hidden style={{ marginRight: 5 }} /> 문서 열기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
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
