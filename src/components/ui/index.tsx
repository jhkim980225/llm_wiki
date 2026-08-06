'use client'
/**
 * 공통 UI 조각 (docs/design.md 컴포넌트 규칙).
 * 스타일은 전부 globals.css 클래스 — 여기는 마크업과 접근성만 담당한다.
 * 파일 하나에 모아 둔 이유: 각각 20줄짜리라 파일 일곱 개는 소음이다.
 */
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'quiet'
  size?: 'sm' | 'md' | 'lg'
}

/** 버튼. 높이 sm 28 / md 34 / lg 40. */
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = 'default', size = 'md', className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(variant !== 'default' && variant, size !== 'md' && size, className)}
      {...rest}
    />
  )
})

type IconBtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string // aria-label 겸 tooltip — 아이콘만 있는 버튼이라 필수
  on?: boolean
}

/** 30×30 아이콘 버튼. */
export const IconButton = forwardRef<HTMLButtonElement, IconBtnProps>(function IconButton(
  { label, on, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn('icon', on && 'on', className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  )
})

/** 글로벌 사이드바 항목. href를 주면 링크, 아니면 버튼. */
export function SidebarItem({
  icon,
  label,
  href,
  on,
  onClick,
}: {
  icon: ReactNode
  label: string
  href?: string
  on?: boolean
  onClick?: () => void
}) {
  const cls = cn('side-item', on && 'on')
  // title은 접힘(아이콘 전용) 상태의 유일한 라벨이다
  if (href) {
    return (
      <a href={href} className={cls} aria-label={label} title={label}>
        {icon}
        <span>{label}</span>
      </a>
    )
  }
  return (
    <button className={cls} onClick={onClick} aria-label={label} title={label}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

type SearchInputProps = InputHTMLAttributes<HTMLInputElement> & { kbd?: string }

/** 검색 입력 — Search 아이콘 + 단축키 배지. */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { kbd, className, ...rest },
  ref,
) {
  return (
    <div className={cn('search-input', className)}>
      <Search size={14} aria-hidden />
      <input ref={ref} type="search" {...rest} />
      {kbd && <kbd>{kbd}</kbd>}
    </div>
  )
})

/** 트리 행. as='a'면 링크(문서), 기본은 버튼(폴더). 드래그 핸들러는 rest로 통과한다. */
export function TreeItem({
  as = 'button',
  indent = 0,
  icon,
  chevron,
  name,
  count,
  active,
  dropInto,
  className,
  ...rest
}: {
  as?: 'button' | 'a'
  indent?: number
  icon?: ReactNode
  chevron?: ReactNode
  name: string
  count?: number
  active?: boolean
  dropInto?: boolean
  className?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} & Record<string, any>) {
  const cls = cn('tree-item', active && 'active', dropInto && 'drop-into', className)
  const style = { paddingLeft: 8 + indent * 16 }
  const body = (
    <>
      {chevron && <span className="twist">{chevron}</span>}
      {icon}
      <span className="name">{name}</span>
      {count !== undefined && <span className="count">{count.toLocaleString('ko-KR')}</span>}
    </>
  )
  if (as === 'a') {
    return (
      <a className={cls} style={style} {...rest}>
        {body}
      </a>
    )
  }
  return (
    <button className={cls} style={style} {...rest}>
      {body}
    </button>
  )
}

/** 상단 문서 탭 한 개. */
export function DocumentTab({
  title,
  href,
  active,
  onClose,
}: {
  title: string
  href: string
  active?: boolean
  onClose: () => void
}) {
  return (
    <div className={cn('tab', active && 'on')}>
      <a className="name" href={href} title={title}>
        {title}
      </a>
      <button className="x" aria-label={`${title} 탭 닫기`} title="탭 닫기" onClick={onClose}>
        <X size={12} />
      </button>
    </div>
  )
}

/** 온보딩 action list 한 줄. */
export function EmptyStateAction({
  icon,
  title,
  desc,
  href,
  onClick,
}: {
  icon: ReactNode
  title: string
  desc: string
  href?: string
  onClick?: () => void
}) {
  const body = (
    <>
      <span className="ic">{icon}</span>
      <span>
        <span className="t">{title}</span>
        <span className="d">{desc}</span>
      </span>
    </>
  )
  if (href) {
    return (
      <a href={href} className="action-item">
        {body}
      </a>
    )
  }
  return (
    <a
      href="#"
      className="action-item"
      onClick={(e) => {
        e.preventDefault()
        onClick?.()
      }}
    >
      {body}
    </a>
  )
}
