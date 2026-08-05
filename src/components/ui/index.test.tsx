// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import {
  Button,
  IconButton,
  SidebarItem,
  TreeItem,
  DocumentTab,
  EmptyStateAction,
} from './index'

afterEach(cleanup)

describe('Button', () => {
  it('default variant/size는 클래스에 넣지 않는다', () => {
    render(<Button>go</Button>)
    const b = screen.getByRole('button', { name: 'go' })
    expect(b.className).not.toMatch(/default|md/)
  })

  it('primary + lg는 클래스로 나간다', () => {
    render(<Button variant="primary" size="lg">go</Button>)
    const b = screen.getByRole('button', { name: 'go' })
    expect(b.className).toMatch(/primary/)
    expect(b.className).toMatch(/lg/)
  })
})

describe('IconButton', () => {
  it('label을 aria-label과 title에 쓰고 on이면 on 클래스', () => {
    render(<IconButton label="설정" on>x</IconButton>)
    const b = screen.getByRole('button', { name: '설정' })
    expect(b.getAttribute('title')).toBe('설정')
    expect(b.className).toMatch(/\bon\b/)
  })
})

describe('SidebarItem', () => {
  it('href가 있으면 링크로 렌더한다', () => {
    render(<SidebarItem icon={null} label="문서" href="/wiki" on />)
    const a = screen.getByRole('link', { name: '문서' })
    expect(a.getAttribute('href')).toBe('/wiki')
    expect(a.className).toMatch(/\bon\b/)
  })

  it('href가 없으면 버튼이고 onClick이 불린다', () => {
    const onClick = vi.fn()
    render(<SidebarItem icon={null} label="도우미" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: '도우미' }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})

describe('TreeItem', () => {
  it('count를 한국어 로케일로 포맷한다', () => {
    render(<TreeItem name="이메일" count={72186} />)
    expect(screen.getByText('72,186')).toBeTruthy()
  })

  it('count가 undefined면 개수 노드를 그리지 않는다', () => {
    const { container } = render(<TreeItem name="빈폴더" />)
    expect(container.querySelector('.count')).toBeNull()
  })

  it('active/dropInto/indent가 클래스와 스타일에 반영된다', () => {
    const { container } = render(<TreeItem name="x" active dropInto indent={2} />)
    const el = container.querySelector('.tree-item') as HTMLElement
    expect(el.className).toMatch(/active/)
    expect(el.className).toMatch(/drop-into/)
    expect(el.style.paddingLeft).toBe('40px') // 8 + 2*16
  })

  it("as='a'면 링크로 렌더하고 드래그 핸들러(rest)를 통과시킨다", () => {
    const onDragStart = vi.fn()
    const { container } = render(
      <TreeItem as="a" name="문서" href="/wiki/x" draggable onDragStart={onDragStart} />,
    )
    const a = container.querySelector('a.tree-item') as HTMLElement
    expect(a.getAttribute('href')).toBe('/wiki/x')
    fireEvent.dragStart(a)
    expect(onDragStart).toHaveBeenCalledOnce()
  })
})

describe('DocumentTab', () => {
  it('active면 on 클래스, 닫기 버튼이 onClose를 부른다', () => {
    const onClose = vi.fn()
    const { container } = render(
      <DocumentTab title="타짜" href="/wiki/tazza" active onClose={onClose} />,
    )
    expect((container.querySelector('.tab') as HTMLElement).className).toMatch(/\bon\b/)
    fireEvent.click(screen.getByRole('button', { name: '타짜 탭 닫기' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('EmptyStateAction', () => {
  it('onClick 형은 기본 이동을 막고 콜백을 부른다', () => {
    const onClick = vi.fn()
    render(<EmptyStateAction icon={null} title="새 문서" desc="Ctrl+N" onClick={onClick} />)
    const a = screen.getByText('새 문서').closest('a') as HTMLElement
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    a.dispatchEvent(ev)
    expect(onClick).toHaveBeenCalledOnce()
    expect(ev.defaultPrevented).toBe(true)
  })
})
