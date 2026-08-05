import { db } from '@/lib/db'

/**
 * 휴지통. 문서·폴더는 soft delete(deletedAt)로 들어오고, 7일이 지나면 영구 삭제된다.
 *
 * 퍼지는 별도 스케줄러 없이 휴지통 API를 부를 때마다 돈다(lazy purge) —
 * 아무도 안 보는 동안 며칠 더 남아 있는 건 해가 없고, 데몬 하나를 덜 관리한다.
 */
export const RETENTION_DAYS = 7

export function cutoff(now = new Date()): Date {
  return new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
}

/** 보존 기한이 지난 것을 영구 삭제한다. 문서 리비전은 FK cascade로 같이 지워진다. */
export async function purgeExpired(now = new Date()): Promise<{ pages: number; folders: number }> {
  const limit = cutoff(now)
  const [pages, folders] = await db.$transaction([
    db.page.deleteMany({ where: { deletedAt: { not: null, lt: limit } } }),
    db.folder.deleteMany({ where: { deletedAt: { not: null, lt: limit } } }),
  ])
  return { pages: pages.count, folders: folders.count }
}

export type TrashItem = {
  kind: 'page' | 'folder'
  id: string
  name: string
  deletedAt: Date
}

/** 휴지통 내용물 — 최근 삭제 순. */
export async function listTrash(): Promise<TrashItem[]> {
  const [pages, folders] = await Promise.all([
    db.page.findMany({
      where: { deletedAt: { not: null } },
      select: { slug: true, title: true, deletedAt: true },
      orderBy: { deletedAt: 'desc' },
    }),
    db.folder.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true, name: true, deletedAt: true },
      orderBy: { deletedAt: 'desc' },
    }),
  ])
  return [
    ...folders.map((f) => ({ kind: 'folder' as const, id: f.id, name: f.name, deletedAt: f.deletedAt! })),
    ...pages.map((p) => ({ kind: 'page' as const, id: p.slug, name: p.title, deletedAt: p.deletedAt! })),
  ].sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime())
}

/**
 * 복원. 원래 있던 폴더가 삭제됐거나 사라졌으면 최상위로 꺼낸다 —
 * 안 보이는 폴더 안으로 복원되면 사용자는 복원이 안 된 줄 안다.
 */
export async function restorePage(slug: string) {
  const page = await db.page.findFirst({ where: { slug, deletedAt: { not: null } } })
  if (!page) return null
  let folderId = page.folderId
  if (folderId) {
    const parent = await db.folder.findFirst({ where: { id: folderId, deletedAt: null } })
    if (!parent) folderId = null
  }
  return db.page.update({ where: { slug }, data: { deletedAt: null, folderId } })
}

export async function restoreFolder(id: string) {
  const folder = await db.folder.findFirst({ where: { id, deletedAt: { not: null } } })
  if (!folder) return null
  let parentId = folder.parentId
  if (parentId) {
    const parent = await db.folder.findFirst({ where: { id: parentId, deletedAt: null } })
    if (!parent) parentId = null
  }
  return db.folder.update({ where: { id }, data: { deletedAt: null, parentId } })
}
