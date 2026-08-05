'use client'
import { useEffect, useState } from 'react'

/**
 * 만들기·이름변경·이동·삭제가 전부 이 하나를 쓴다.
 * 확인은 값을 돌려주고(삭제·확인은 빈 문자열), 취소는 onCancel이다.
 */
export type DialogSpec =
  | { mode: 'text'; title: string; label: string; initial: string; confirm: string }
  | { mode: 'folder'; title: string; initial: string | null; confirm: string }
  | { mode: 'confirm'; title: string; body: string; confirm: string; danger?: true }

type Folder = { id: string; name: string; parentId: string | null }

export function Dialog({
  spec,
  onConfirm,
  onCancel,
}: {
  spec: DialogSpec
  onConfirm: (value: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(spec.mode === 'text' ? spec.initial : '')
  const [folderId, setFolderId] = useState(spec.mode === 'folder' ? (spec.initial ?? '') : '')
  const [folders, setFolders] = useState<Folder[]>([])

  useEffect(() => {
    if (spec.mode !== 'folder') return
    fetch('/api/folders')
      .then((r) => r.json())
      .then((b) => setFolders(b.items))
  }, [spec.mode])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const value = spec.mode === 'text' ? text : spec.mode === 'folder' ? folderId : ''
  const blocked = spec.mode === 'text' && !text.trim()

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal-card">
        <h3>{spec.title}</h3>

        {spec.mode === 'text' && (
          <input
            autoFocus
            value={text}
            placeholder={spec.label}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !blocked && onConfirm(text)}
          />
        )}

        {spec.mode === 'folder' && (
          <select autoFocus value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value="">(루트)</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}

        {spec.mode === 'confirm' && <p style={{ margin: 0, fontSize: 13 }}>{spec.body}</p>}

        <div className="buttons">
          <button className="quiet" onClick={onCancel}>
            취소
          </button>
          <button
            className="primary"
            disabled={blocked}
            onClick={() => onConfirm(value)}
            style={spec.mode === 'confirm' && spec.danger ? { background: 'var(--danger)', borderColor: 'var(--danger)' } : undefined}
          >
            {spec.confirm}
          </button>
        </div>
      </div>
    </div>
  )
}

export type MenuItem = { label: string; danger?: true; run: () => void }

/** 메뉴를 연 버튼의 화면 좌표. anchorOf로 만든다. */
export type Anchor = { x: number; top: number; bottom: number }

export function anchorOf(el: HTMLElement): Anchor {
  const r = el.getBoundingClientRect()
  return { x: r.right, top: r.top, bottom: r.bottom }
}

/**
 * 열려 있는 작은 메뉴. 바깥을 누르면 닫힌다.
 *
 * fixed로 띄운다. 사이드바(.sidebar-body)와 본문(.doc)이 둘 다 overflow:auto라
 * 절대배치로 두면 아래쪽 행에서 메뉴가 잘린다.
 */
export function Menu({ items, at, onClose }: { items: MenuItem[]; at: Anchor; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose()
    // 이 클릭이 메뉴를 연 그 클릭이라 다음 틱부터 듣는다.
    const t = setTimeout(() => window.addEventListener('click', close), 0)
    return () => {
      clearTimeout(t)
      window.removeEventListener('click', close)
    }
  }, [onClose])

  // 화면 아래에 걸리면 버튼 위로 뒤집는다.
  const flip = at.bottom + items.length * 27 + 8 > window.innerHeight

  return (
    <div
      className="menu"
      style={{
        left: at.x,
        top: flip ? undefined : at.bottom,
        bottom: flip ? window.innerHeight - at.top : undefined,
      }}
    >
      {items.map((it) => (
        <button
          key={it.label}
          className={it.danger ? 'danger' : undefined}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
            it.run()
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
