import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { IMPORT_SOURCE } from '@/lib/ontology/import'

const PAGE_SIZE = 200

/**
 * 사이드바 트리 한 단계.
 *
 * 기본은 **사람과 에이전트가 쓴 문서만** 보여준다. 온톨로지 적재본은 소스 하나가
 * 수만 건이라 트리를 통째로 덮어버려서, 정작 자기가 쓴 문서를 찾을 수 없다.
 * 적재본까지 보려면 ?all=1.
 */
export async function GET(req: Request) {
  const u = new URL(req.url)
  const raw = u.searchParams.get('folderId')
  const folderId = raw === null || raw === '' ? null : raw
  const offset = Math.max(Number(u.searchParams.get('offset')) || 0, 0)
  const all = u.searchParams.get('all') === '1'

  const visible = {
    deletedAt: null,
    ...(all ? {} : { lastEditSource: { not: IMPORT_SOURCE } }),
  }

  const [folders, pages, total] = await Promise.all([
    db.folder.findMany({ where: { parentId: folderId, deletedAt: null }, orderBy: { name: 'asc' } }),
    db.page.findMany({
      where: { folderId, ...visible },
      select: { slug: true, title: true },
      orderBy: { title: 'asc' },
      take: PAGE_SIZE,
      skip: offset,
    }),
    db.page.count({ where: { folderId, ...visible } }),
  ])

  // 폴더별 문서 수는 트리에 숫자로 띄운다. 전체 수도 함께 세는데,
  // "비어 있는 폴더"와 "적재본만 든 폴더"를 갈라야 하기 때문이다.
  const [counts, totals, childCounts] = await Promise.all([
    Promise.all(folders.map((f) => db.page.count({ where: { folderId: f.id, ...visible } }))),
    Promise.all(folders.map((f) => db.page.count({ where: { folderId: f.id, deletedAt: null } }))),
    Promise.all(folders.map((f) => db.folder.count({ where: { parentId: f.id, deletedAt: null } }))),
  ])

  // 숨기는 건 **적재본만 든 폴더** 하나뿐이다. 방금 만든 빈 폴더까지 숨기면
  // "폴더 만들기"를 눌러도 아무 일도 안 일어난 것처럼 보인다.
  const shown = folders
    .map((f, i) => ({ id: f.id, name: f.name, count: counts[i] }))
    .filter((_, i) => all || counts[i] > 0 || childCounts[i] > 0 || totals[i] === 0)

  return NextResponse.json({
    folders: shown,
    pages,
    total,
    hasMore: offset + pages.length < total,
  })
}
