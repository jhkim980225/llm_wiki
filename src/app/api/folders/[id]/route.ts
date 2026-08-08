import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { wouldCycle } from '@/lib/folders/tree'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null)

  const folder = await db.folder.findUnique({ where: { id } })
  if (!folder) return NextResponse.json({ error: 'not found' }, { status: 404 })

  if ('parentId' in body) {
    const parentId: string | null = body.parentId ?? null
    if (await wouldCycle(id, parentId)) {
      return NextResponse.json({ error: 'move would create a folder cycle' }, { status: 400 })
    }
  }

  const updated = await db.folder.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...('parentId' in body ? { parentId: body.parentId ?? null } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
    },
  })

  // 경로 캐시가 없어졌다. 폴더 이름/위치는 folder 행 한 줄만 바뀌고, 페이지 경로는
  // 조회 시 folderId에서 유도한다. 예전엔 자손 7만 건을 다시 써서 수십 초 걸렸다.
  return NextResponse.json(updated)
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [childCount, pageCount] = await Promise.all([
    db.folder.count({ where: { parentId: id, deletedAt: null } }),
    db.page.count({ where: { folderId: id, deletedAt: null } }),
  ])
  if (childCount > 0 || pageCount > 0) {
    return NextResponse.json(
      { error: 'folder is not empty', childCount, pageCount },
      { status: 409 },
    )
  }

  // 휴지통으로 — 7일 뒤 퍼지된다 (lib/trash.ts)
  await db.folder.update({ where: { id }, data: { deletedAt: new Date() } })
  return NextResponse.json({ ok: true })
}
