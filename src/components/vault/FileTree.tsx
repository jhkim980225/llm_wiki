'use client'
import { useCallback, useEffect, useState } from 'react'

type Folder = { id: string; name: string; count: number }
type Page = { slug: string; title: string }
type Level = { folders: Folder[]; pages: Page[]; total: number; hasMore: boolean }

async function loadLevel(folderId: string | null, offset = 0): Promise<Level> {
  const q = new URLSearchParams({ offset: String(offset) })
  if (folderId) q.set('folderId', folderId)
  const r = await fetch(`/api/tree?${q}`)
  return r.json()
}

/** 한 폴더 안. 펼칠 때만 자식을 불러온다 — 문서가 수만 건이라 통째로 못 내린다. */
function Branch({
  folderId,
  depth,
  activeSlug,
}: {
  folderId: string | null
  depth: number
  activeSlug: string
}) {
  const [level, setLevel] = useState<Level | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadLevel(folderId).then(setLevel)
  }, [folderId])

  const more = useCallback(async () => {
    if (!level) return
    setLoading(true)
    const next = await loadLevel(folderId, level.pages.length)
    setLevel({ ...next, pages: [...level.pages, ...next.pages] })
    setLoading(false)
  }, [folderId, level])

  if (!level) return null
  const pad = 6 + depth * 12

  return (
    <>
      {level.folders.map((f) => {
        const isOpen = open.has(f.id)
        return (
          <div key={f.id}>
            <button
              className="tree-item"
              style={{ paddingLeft: pad }}
              onClick={() =>
                setOpen((prev) => {
                  const n = new Set(prev)
                  if (n.has(f.id)) n.delete(f.id)
                  else n.add(f.id)
                  return n
                })
              }
            >
              <span className="twist">{isOpen ? '▾' : '▸'}</span>
              <span className="name">{f.name}</span>
              <span className="count">{f.count.toLocaleString('ko-KR')}</span>
            </button>
            {isOpen && <Branch folderId={f.id} depth={depth + 1} activeSlug={activeSlug} />}
          </div>
        )
      })}

      {level.pages.map((p) => (
        <a
          key={p.slug}
          href={`/wiki/${p.slug}`}
          className={`tree-item${p.slug === activeSlug ? ' active' : ''}`}
          style={{ paddingLeft: pad + 16 }}
          title={p.slug}
        >
          <span className="name">{p.title}</span>
        </a>
      ))}

      {level.hasMore && (
        <button className="tree-more" style={{ marginLeft: pad + 16 }} onClick={more} disabled={loading}>
          {loading ? '…' : `더 보기 (${(level.total - level.pages.length).toLocaleString('ko-KR')})`}
        </button>
      )}
    </>
  )
}

export function FileTree({ activeSlug }: { activeSlug: string }) {
  return <Branch folderId={null} depth={0} activeSlug={activeSlug} />
}
