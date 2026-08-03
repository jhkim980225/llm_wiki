import type { Page, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { parseOutLinks } from '@/lib/wiki/links'

/** 이 필드들이 실제로 바뀔 때만 version을 올린다. 링크 유지보수는 장부성 쓰기다. */
export const VISIBLE_FIELDS = ['title', 'content', 'summary', 'pageType', 'status'] as const

export class VersionConflictError extends Error {
  constructor(public currentVersion: number) {
    super(`version conflict: server is at ${currentVersion}`)
    this.name = 'VersionConflictError'
  }
}

/** before에서 사라진 대상의 백링크를 빼고, after에 새로 생긴 대상에 더한다. */
export async function syncBacklinks(
  tx: Prisma.TransactionClient,
  slug: string,
  before: string[],
  after: string[],
): Promise<void> {
  const removed = before.filter((s) => !after.includes(s))
  const added = after.filter((s) => !before.includes(s))

  for (const target of removed) {
    const p = await tx.page.findUnique({ where: { slug: target } })
    if (!p) continue
    await tx.page.update({
      where: { slug: target },
      data: { inLinks: p.inLinks.filter((s) => s !== slug) },
    })
  }
  for (const target of added) {
    const p = await tx.page.findUnique({ where: { slug: target } })
    if (!p || p.inLinks.includes(slug)) continue
    await tx.page.update({ where: { slug: target }, data: { inLinks: [...p.inLinks, slug] } })
  }
}

export type CreateInput = {
  slug: string
  title: string
  content?: string
  summary?: string
  pageType?: string
  aliases?: string[]
  folderId?: string | null
  editSource?: 'user' | 'agent' | 'revert'
}

/**
 * 페이지를 만든다. 같은 slug의 삭제된 페이지가 있으면 그 행을 되살린다.
 * slug 유니크 인덱스는 삭제된 행에도 걸리므로, 되살리지 않으면 한 번 지운
 * 이름은 영영 다시 쓸 수 없다. 리비전은 남겨 같은 이름의 역사를 잇는다.
 * 이미 살아 있는 slug면 P2002를 그대로 던져 호출자가 409로 옮긴다.
 */
export async function createOrRevivePage(input: CreateInput): Promise<Page> {
  const content = input.content ?? ''
  const outLinks = parseOutLinks(content)
  const buried = await db.page.findFirst({ where: { slug: input.slug, NOT: { deletedAt: null } } })

  const data = {
    title: input.title,
    content,
    summary: input.summary ?? '',
    pageType: input.pageType ?? 'concept',
    aliases: input.aliases ?? [],
    folderId: input.folderId ?? null,
    outLinks,
    lastEditSource: input.editSource ?? 'user',
  }

  return db.$transaction(async (tx) => {
    const saved = buried
      ? await tx.page.update({
          where: { id: buried.id },
          data: { ...data, deletedAt: null, version: buried.version + 1 },
        })
      : await tx.page.create({ data: { ...data, slug: input.slug } })
    await syncBacklinks(tx, saved.slug, buried?.outLinks ?? [], outLinks)
    return saved
  })
}

export type SaveInput = {
  slug: string
  expectedVersion: number
  title?: string
  content?: string
  summary?: string
  pageType?: string
  status?: string
  editSource?: 'user' | 'agent' | 'revert'
}

/**
 * 한 트랜잭션 안에서: 낙관적 잠금 확인 → 편집 전 스냅샷 저장 →
 * 아웃링크 재계산 → 양방향 백링크 동기화 → 가시 필드가 바뀐 경우만 version++.
 */
export async function savePage(input: SaveInput): Promise<Page> {
  return db.$transaction(async (tx) => {
    // 삭제된 페이지는 편집 대상이 아니다 — 되살리려면 createOrRevivePage를 쓴다.
    const current = await tx.page.findFirst({ where: { slug: input.slug, deletedAt: null } })
    if (!current) throw new Error(`page not found: ${input.slug}`)
    if (current.version !== input.expectedVersion) throw new VersionConflictError(current.version)

    const next = {
      title: input.title ?? current.title,
      content: input.content ?? current.content,
      summary: input.summary ?? current.summary,
      pageType: input.pageType ?? current.pageType,
      status: input.status ?? current.status,
    }
    const visibleChanged = VISIBLE_FIELDS.some((f) => next[f] !== current[f])

    if (visibleChanged) {
      await tx.pageRevision.create({
        data: {
          pageId: current.id,
          slug: current.slug,
          version: current.version,
          title: current.title,
          content: current.content,
          summary: current.summary,
          pageType: current.pageType,
          status: current.status,
          editSource: current.lastEditSource,
        },
      })
    }

    const outLinks = parseOutLinks(next.content)
    await syncBacklinks(tx, current.slug, current.outLinks, outLinks)

    return tx.page.update({
      where: { slug: current.slug },
      data: {
        ...next,
        outLinks,
        version: visibleChanged ? current.version + 1 : current.version,
        lastEditSource: visibleChanged ? (input.editSource ?? 'user') : current.lastEditSource,
      },
    })
  })
}
