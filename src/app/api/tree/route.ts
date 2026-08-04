import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const PAGE_SIZE = 200

/**
 * 사이드바 트리 한 단계. 문서가 수만 건이라 한 번에 다 내리지 않고
 * 폴더를 펼칠 때마다 그 폴더의 자식만 준다.
 */
export async function GET(req: Request) {
  const u = new URL(req.url)
  const raw = u.searchParams.get('folderId')
  const folderId = raw === null || raw === '' ? null : raw
  const offset = Math.max(Number(u.searchParams.get('offset')) || 0, 0)

  const [folders, pages, total] = await Promise.all([
    db.folder.findMany({ where: { parentId: folderId }, orderBy: { name: 'asc' } }),
    db.page.findMany({
      where: { folderId, deletedAt: null },
      select: { slug: true, title: true },
      orderBy: { title: 'asc' },
      take: PAGE_SIZE,
      skip: offset,
    }),
    db.page.count({ where: { folderId, deletedAt: null } }),
  ])

  // 폴더별 문서 수는 트리에 숫자로 띄운다.
  const counts = await Promise.all(
    folders.map((f) => db.page.count({ where: { folderId: f.id, deletedAt: null } })),
  )

  return NextResponse.json({
    folders: folders.map((f, i) => ({ id: f.id, name: f.name, count: counts[i] })),
    pages,
    total,
    hasMore: offset + pages.length < total,
  })
}
