import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  const items = await db.folder.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
  return NextResponse.json({ items })
}

export async function POST(req: Request) {
  const body = await req.json()
  if (!body?.name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const parentId: string | null = body.parentId ?? null
  if (parentId && !(await db.folder.findFirst({ where: { id: parentId, deletedAt: null } }))) {
    return NextResponse.json({ error: 'parent folder not found' }, { status: 404 })
  }

  const folder = await db.folder.create({
    data: { name: body.name, parentId, sortOrder: body.sortOrder ?? 0 },
  })
  return NextResponse.json(folder, { status: 201 })
}
