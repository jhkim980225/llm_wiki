'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  Code,
  Copy,
  Download,
  Heading1,
  Heading2,
  Heading3,
  History,
  Image as ImageIcon,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  MoreHorizontal,
  Quote,
  Share2,
  Star,
  Table,
  Trash2,
  X,
} from 'lucide-react'
import { lineDiff } from '@/lib/wiki/diff'
import { normalizeSlug } from '@/lib/wiki/slug'
import { toast } from '@/lib/toast'
import { Dialog } from '@/components/vault/Dialog'
import type { PageData } from './PageView'

type Conflict = { serverContent: string; serverVersion: number }
type Proposal = { content: string; added: { slug: string; title: string }[] }

const SOURCE_LABEL: Record<string, string> = {
  user: '사용자',
  agent: 'AI',
  revert: '되돌리기',
  ontology: '온톨로지',
}

const STATUS_LABEL: Record<string, string> = { draft: '초안', published: '발행' }

type Suggest = {
  /** 본문에서 `[[`가 시작되는 오프셋 */
  start: number
  query: string
  items: { slug: string; title: string }[]
  index: number
  top: number
  left: number
}

/**
 * textarea 캐럿의 픽셀 좌표 — 같은 서체·폭의 미러 div에 캐럿까지의 텍스트를 붓고
 * 끝에 놓은 marker span의 위치를 읽는다 (textarea에는 DOM 좌표가 없다).
 */
function caretXY(el: HTMLTextAreaElement): { top: number; left: number } {
  const s = getComputedStyle(el)
  const div = document.createElement('div')
  div.style.cssText =
    `position:absolute;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;` +
    `width:${el.clientWidth}px;font:${s.font};line-height:${s.lineHeight};` +
    `letter-spacing:${s.letterSpacing};padding:${s.padding};box-sizing:${s.boxSizing};`
  div.textContent = el.value.slice(0, el.selectionStart)
  const marker = document.createElement('span')
  marker.textContent = '​'
  div.appendChild(marker)
  document.body.appendChild(div)
  const xy = { top: marker.offsetTop - el.scrollTop, left: marker.offsetLeft }
  div.remove()
  return xy
}

/** "1분 전" 식 상대 시간. 정밀할 필요 없다 — 저장 직후 감각용. */
function relTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return '방금'
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`
  return new Date(iso).toISOString().slice(0, 10)
}

/**
 * 문서 편집기 — 좌측 본문(제목·태그·별칭·포맷 툴바·마크다운) + 우측 '문서 정보' 패널.
 * 저장은 낙관적 잠금 그대로: 409면 diff를 보여주고 사용자가 고른다. 자동 병합 없음.
 */
export function PageEditor({
  page,
  onSaved,
  onCancel,
  onShowRevisions,
}: {
  page: PageData
  onSaved: (updated: PageData) => void
  onCancel: () => void
  onShowRevisions?: () => void
}) {
  const [title, setTitle] = useState(page.title)
  const summary = page.summary // 편집 UI에서 제거 — 저장 시 그대로 유지
  const [pageType, setPageType] = useState(page.pageType)
  const [status, setStatus] = useState(page.status ?? 'published')
  const [aliases, setAliases] = useState<string[]>(page.aliases)
  const [aliasInput, setAliasInput] = useState('')
  const [content, setContent] = useState(page.content)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [linking, setLinking] = useState(false)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [savedAt, setSavedAt] = useState(page.updatedAt)
  const [infoOpen, setInfoOpen] = useState(true)
  const [suggest, setSuggest] = useState<Suggest | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const router = useRouter()

  const dirty = useMemo(
    () =>
      title !== page.title ||
      content !== page.content ||
      pageType !== page.pageType ||
      status !== (page.status ?? 'published') ||
      JSON.stringify(aliases) !== JSON.stringify(page.aliases),
    [title, content, pageType, status, aliases, page],
  )

  /** 커서 위치에 마크다운 조각을 끼운다. 선택이 있으면 감싼다. */
  const insert = (before: string, after = '', placeholder = '') => {
    const el = bodyRef.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e, value } = el
    const selected = value.slice(s, e) || placeholder
    const next = value.slice(0, s) + before + selected + after + value.slice(e)
    setContent(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(s + before.length, s + before.length + selected.length)
    })
  }

  /** 줄 앞머리 마크다운(제목·목록·인용)은 줄 시작에 넣어야 한다. */
  const insertLine = (prefix: string, placeholder = '') => {
    const el = bodyRef.current
    if (!el) return
    const { selectionStart: s, value } = el
    const lineStart = value.lastIndexOf('\n', s - 1) + 1
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart)
    setContent(next)
    const pos = s + prefix.length
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(pos, pos + (value.slice(lineStart, s).length === 0 ? placeholder.length : 0))
    })
  }

  /** 본문 변경 — `[[검색어` 패턴이면 실존 문서를 찾아 드롭다운을 띄운다. */
  const onBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setContent(value)

    const el = e.target
    const pos = el.selectionStart
    const m = value.slice(0, pos).match(/\[\[([^\]\n|]*)$/)
    if (!m || m[1].length === 0) {
      setSuggest(null)
      return
    }
    const query = m[1]
    const start = pos - query.length - 2
    const xy = caretXY(el)

    clearTimeout(suggestTimer.current)
    suggestTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=8&prefer=human`)
        const body = await res.json()
        // 드롭다운엔 문서명만 보여준다 — 같은 제목은 랭킹 상위 하나만 남긴다
        const seen = new Set<string>()
        const items = (body.items ?? [])
          .filter((it: { title: string }) => !seen.has(it.title) && seen.add(it.title))
          .map((it: { slug: string; title: string }) => ({ slug: it.slug, title: it.title }))
        // 응답이 오는 사이 캐럿이 딴 데로 갔으면 버린다
        const now = bodyRef.current
        if (!now || now.selectionStart < start + 2) return
        setSuggest(items.length ? { start, query, items, index: 0, top: xy.top, left: xy.left } : null)
      } catch {
        setSuggest(null)
      }
    }, 150)
  }

  /** 드롭다운에서 문서 선택 — `[[검색어`를 완성된 링크로 치환한다. */
  const pickSuggest = (item: { slug: string; title: string }) => {
    const el = bodyRef.current
    if (!el || !suggest) return
    // 제목이 slug로 정규화되는 경우엔 [[제목]]으로 깔끔하게, 아니면 [[slug|제목]]
    const link =
      normalizeSlug(item.title) === item.slug ? `[[${item.title}]]` : `[[${item.slug}|${item.title}]]`
    const pos = el.selectionStart
    // 사용자가 이미 ]]까지 쳐놓은 상태([[황]])면 그 닫힘을 삼킨다 — ]]]] 방지
    const trailing = content.slice(pos, pos + 2) === ']]' ? 2 : 0
    const next = content.slice(0, suggest.start) + link + content.slice(pos + trailing)
    setContent(next)
    setSuggest(null)
    const caret = suggest.start + link.length
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  const onBodyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!suggest) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const delta = e.key === 'ArrowDown' ? 1 : -1
      setSuggest({ ...suggest, index: (suggest.index + delta + suggest.items.length) % suggest.items.length })
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      pickSuggest(suggest.items[suggest.index])
    } else if (e.key === 'Escape') {
      setSuggest(null)
    }
  }

  const save = async (expectedVersion: number) => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/pages/${encodeURIComponent(page.slug)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion,
          title,
          summary,
          content,
          status,
          pageType: pageType.trim() || 'concept',
          aliases,
        }),
      })
      const body = await res.json()

      if (res.status === 409) {
        const fresh = await fetch(`/api/pages/${encodeURIComponent(page.slug)}`).then((r) => r.json())
        setConflict({ serverContent: fresh.content, serverVersion: body.currentVersion })
        return
      }
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        toast('저장에 실패했습니다.', 'error')
        return
      }
      setConflict(null)
      setSavedAt(new Date().toISOString())
      toast('저장했습니다.', 'success')
      window.dispatchEvent(new Event('wiki:refresh'))
      onSaved(body)
    } finally {
      setSaving(false)
    }
  }

  // Ctrl+S 저장 · Delete 삭제(입력란에 포커스가 없을 때만 — 글자 지우기와 충돌한다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!saving) save(page.version)
      }
      if (e.key === 'Delete' && !(e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) {
        setConfirmDelete(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, pageType, status, aliases, saving, page.version])

  const proposeLinks = async () => {
    setLinking(true)
    setError(null)
    try {
      const res = await fetch(`/api/pages/${encodeURIComponent(page.slug)}/linkify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      if (!body.changed) {
        toast('본문에 이름이 나오는 다른 문서가 없습니다.', 'info')
        return
      }
      setProposal({ content: body.content, added: body.added })
    } finally {
      setLinking(false)
    }
  }

  const duplicate = async () => {
    const slug = `${normalizeSlug(title) || page.slug}-사본-${Date.now().toString(36)}`
    const res = await fetch('/api/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, title: `${title} 사본`, content, summary, pageType }),
    })
    if (res.ok) {
      toast('문서를 복제했습니다.', 'success')
      window.dispatchEvent(new Event('wiki:refresh'))
      router.push(`/wiki/${slug.split('/').map(encodeURIComponent).join('/')}`)
    } else {
      toast('복제에 실패했습니다.', 'error')
    }
  }

  const exportMd = () => {
    const blob = new Blob([`# ${title}\n\n${content}`], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${title || page.slug}.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const remove = async () => {
    setConfirmDelete(false)
    const res = await fetch(`/api/pages/${encodeURIComponent(page.slug)}`, { method: 'DELETE' })
    if (res.ok) {
      toast('휴지통으로 이동했습니다.', 'success')
      window.dispatchEvent(new Event('wiki:refresh'))
      router.push('/')
    } else {
      toast('삭제에 실패했습니다.', 'error')
    }
  }

  const addAlias = () => {
    const v = aliasInput.trim()
    if (v && !aliases.includes(v)) setAliases([...aliases, v])
    setAliasInput('')
  }

  // 충돌·링크 제안은 전용 화면으로 전환한다 (기존 동작 유지)
  if (proposal) {
    const diff = lineDiff(content, proposal.content)
    return (
      <div className="doc-inner" style={{ maxWidth: 700 }}>
        <h3>링크 {proposal.added.length}개를 잇습니다</h3>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
          본문에 이름이 나오는 문서의 첫 출현만 감쌉니다. 코드 블록과 이미 걸린 링크는 건드리지
          않습니다. 적용해도 저장되지는 않습니다.
        </p>
        <p className="meta" style={{ marginBottom: 10 }}>
          {proposal.added.map((a) => a.title).join(' · ')}
        </p>
        <pre className="diff">
          {diff.map((l, i) => (
            <div key={i} className={l.type === 'same' ? undefined : l.type}>
              {l.type === 'add' ? '+ ' : l.type === 'del' ? '− ' : '  '}
              {l.text}
            </div>
          ))}
        </pre>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            className="primary"
            onClick={() => {
              setContent(proposal.content)
              setProposal(null)
            }}
          >
            적용
          </button>
          <button className="quiet" onClick={() => setProposal(null)}>
            취소
          </button>
        </div>
      </div>
    )
  }

  if (conflict) {
    const diff = lineDiff(conflict.serverContent, content)
    return (
      <div className="doc-inner" style={{ maxWidth: 700 }}>
        <p className="notice">저장 충돌</p>
        <h3>다른 곳에서 이 문서가 v{conflict.serverVersion}로 바뀌었습니다</h3>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
          서버 본문 기준으로 내 편집이 더한 줄(+)과 지운 줄(−)입니다. 자동으로 합치지 않습니다.
        </p>
        <pre className="diff">
          {diff.map((l, i) => (
            <div key={i} className={l.type === 'same' ? undefined : l.type}>
              {l.type === 'add' ? '+ ' : l.type === 'del' ? '− ' : '  '}
              {l.text}
            </div>
          ))}
        </pre>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="primary" onClick={() => save(conflict.serverVersion)} disabled={saving}>
            내 편집으로 덮어쓰기
          </button>
          <button className="quiet" onClick={() => setConflict(null)}>
            돌아가기
          </button>
        </div>
      </div>
    )
  }

  const toolbar: { icon: React.ReactNode; label: string; run: () => void }[] = [
    { icon: <Heading1 size={15} />, label: '제목 1', run: () => insertLine('# ') },
    { icon: <Heading2 size={15} />, label: '제목 2', run: () => insertLine('## ') },
    { icon: <Heading3 size={15} />, label: '제목 3', run: () => insertLine('### ') },
    { icon: <List size={15} />, label: '목록', run: () => insertLine('- ') },
    { icon: <ListOrdered size={15} />, label: '번호 목록', run: () => insertLine('1. ') },
    { icon: <ListChecks size={15} />, label: '체크리스트', run: () => insertLine('- [ ] ') },
    { icon: <Quote size={15} />, label: '인용', run: () => insertLine('> ') },
    { icon: <Code size={15} />, label: '코드 블록', run: () => insert('\n```\n', '\n```\n', '코드') },
    { icon: <Link2 size={15} />, label: '위키링크', run: () => insert('[[', ']]', '문서-slug') },
    { icon: <ImageIcon size={15} />, label: '이미지', run: () => insert('![', '](주소)', '설명') },
    {
      icon: <Table size={15} />,
      label: '표',
      run: () => insert('\n| 항목 | 값 |\n|---|---|\n| ', ' |  |\n'),
    },
  ]

  return (
    <div className="editor">
      <div className="editor-main">
        <div className="editor-top">
          <button className="icon" aria-label="뒤로" title="뒤로" onClick={() => router.back()}>
            <ArrowLeft size={15} />
          </button>
          <button className="icon" aria-label="앞으로" title="앞으로" onClick={() => router.forward()}>
            <ArrowRight size={15} />
          </button>
          <span className="grow" />
          <button
            className="icon"
            aria-label="즐겨찾기"
            title="즐겨찾기"
            onClick={() => toast('즐겨찾기는 준비 중입니다.', 'info')}
          >
            <Star size={15} />
          </button>
          <button
            className="icon"
            aria-label="더보기"
            title="문서 정보 열기/닫기"
            onClick={() => setInfoOpen((v) => !v)}
          >
            <MoreHorizontal size={15} />
          </button>
          <button className="quiet share" onClick={() => toast('공유 기능은 준비 중입니다.', 'info')}>
            <Share2 size={13} aria-hidden /> 공유
          </button>
        </div>

        <div className="editor-scroll">
          <p className="editor-meta">
            v{page.version} · {STATUS_LABEL[status] ?? status}
            <span className="meta">저장됨: {relTime(savedAt)}</span>
          </p>

          <input
            className="editor-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목을 입력하세요"
            aria-label="제목"
          />

          <div className="editor-props">
            <span className="k">태그</span>
            <input
              className="pill-input type"
              value={pageType}
              onChange={(e) => setPageType(e.target.value)}
              aria-label="문서 유형"
              size={Math.max(4, pageType.length)}
            />
            <span className="k" style={{ marginLeft: 10 }}>
              별칭
            </span>
            {aliases.map((a) => (
              <span key={a} className="pill">
                {a}
                <button aria-label={`${a} 삭제`} onClick={() => setAliases(aliases.filter((x) => x !== a))}>
                  <X size={11} />
                </button>
              </span>
            ))}
            <input
              className="pill-input"
              value={aliasInput}
              onChange={(e) => setAliasInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addAlias()
                }
              }}
              onBlur={addAlias}
              placeholder="+"
              aria-label="별칭 추가"
              size={Math.max(2, aliasInput.length)}
            />
          </div>

          <div className="editor-toolbar" role="toolbar" aria-label="서식">
            {toolbar.map((t, i) => (
              <button key={i} className="icon" title={t.label} aria-label={t.label} onClick={t.run}>
                {t.icon}
              </button>
            ))}
          </div>

          <div className="editor-body-wrap">
            <textarea
              ref={bodyRef}
              className="editor-body"
              value={content}
              onChange={onBodyChange}
              onKeyDown={onBodyKeyDown}
              onBlur={() => setTimeout(() => setSuggest(null), 150)}
              placeholder="마크다운으로 작성합니다."
            />
            {suggest && (
              <div
                className="link-suggest"
                role="listbox"
                aria-label="문서 링크 추천"
                style={{ top: suggest.top + 26, left: Math.min(suggest.left, 480) }}
              >
                {suggest.items.map((it, i) => (
                  <button
                    key={it.slug}
                    role="option"
                    aria-selected={i === suggest.index}
                    className={i === suggest.index ? 'on' : ''}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      pickSuggest(it)
                    }}
                    onMouseEnter={() => setSuggest({ ...suggest, index: i })}
                  >
                    <span className="t">{it.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="editor-foot">
          <span className={`state${dirty ? ' dirty' : ''}`}>
            {error ? (
              <span className="notice">{error}</span>
            ) : dirty ? (
              '저장되지 않은 변경이 있습니다'
            ) : (
              '모든 변경사항이 저장되었습니다'
            )}
          </span>
          <span className="grow" />
          <button className="primary" onClick={() => save(page.version)} disabled={saving || !dirty}>
            {saving ? '저장 중…' : '저장'}
          </button>
          <button className="quiet" onClick={proposeLinks} disabled={linking || saving}>
            {linking ? '찾는 중…' : '링크 잇기'}
          </button>
          <button className="quiet" onClick={onCancel}>
            취소
          </button>
        </div>
      </div>

      {infoOpen && (
        <aside className="editor-info" aria-label="문서 정보">
          <div className="head">
            문서 정보
            <span className="grow" />
            <button className="icon" aria-label="닫기" onClick={() => setInfoOpen(false)}>
              <X size={14} />
            </button>
          </div>

          <div className="rows">
            <span className="k">마지막 편집</span>
            <span className="v">{SOURCE_LABEL[page.lastEditSource] ?? page.lastEditSource}</span>
            <span className="k">최종 수정</span>
            <span className="v">{new Date(savedAt).toISOString().slice(0, 16).replace('T', ' ')}</span>
            <span className="k">상태</span>
            <span className="v">
              <button
                className={`badge${status === 'draft' ? ' draft' : ''}`}
                title="클릭해서 초안/발행 전환"
                onClick={() => setStatus(status === 'draft' ? 'published' : 'draft')}
              >
                ● {STATUS_LABEL[status] ?? status}
              </button>
            </span>
            <span className="k">문서 ID</span>
            <span className="v mono">{page.slug}</span>
            <span className="k">버전</span>
            <span className="v">v{page.version}</span>
          </div>

          <div className="links">
            <button onClick={() => onShowRevisions?.()}>
              <History size={14} aria-hidden /> 버전 히스토리
            </button>
          </div>

          <div className="links">
            <button onClick={duplicate}>
              <Copy size={14} aria-hidden /> 복제
            </button>
            <button onClick={exportMd}>
              <Download size={14} aria-hidden /> 내보내기 (.md)
            </button>
          </div>

          <div className="links danger">
            <button onClick={() => setConfirmDelete(true)}>
              <Trash2 size={14} aria-hidden /> 문서 삭제
            </button>
          </div>
        </aside>
      )}

      {confirmDelete && (
        <Dialog
          spec={{
            mode: 'confirm',
            title: '문서 삭제',
            body: `"${title}"을 지웁니다. 이 문서를 가리키던 링크는 끊긴 링크로 남습니다.`,
            confirm: '삭제',
            danger: true,
          }}
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
