import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { wouldCycle, recomputePagePaths } from '@/lib/folders/tree'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

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

  // 이름이나 위치가 바뀌면 이 폴더와 모든 자손의 페이지 경로 캐시를 다시 새긴다.
  const stack = [id]
  while (stack.length > 0) {
    const current = stack.pop()!
    await recomputePagePaths(current)
    const children = await db.folder.findMany({ where: { parentId: current }, select: { id: true } })
    stack.push(...children.map((c) => c.id))
  }

  return NextResponse.json(updated)
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [childCount, pageCount] = await Promise.all([
    db.folder.count({ where: { parentId: id } }),
    db.page.count({ where: { folderId: id, deletedAt: null } }),
  ])
  if (childCount > 0 || pageCount > 0) {
    return NextResponse.json(
      { error: 'folder is not empty', childCount, pageCount },
      { status: 409 },
    )
  }

  await db.folder.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
