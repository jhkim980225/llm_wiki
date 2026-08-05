import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { createOrRevivePage } from '@/lib/pages/save'
import { embedPageSafe } from '@/lib/pages/embedding'

const MAX_LIMIT = 200

export async function GET(req: Request) {
  const u = new URL(req.url)
  const type = u.searchParams.get('type')
  const folderId = u.searchParams.get('folderId')
  const limit = Math.min(Number(u.searchParams.get('limit')) || 50, MAX_LIMIT)
  const offset = Math.max(Number(u.searchParams.get('offset')) || 0, 0)

  const where = {
    deletedAt: null,
    ...(type ? { pageType: type } : {}),
    ...(folderId !== null ? { folderId: folderId === '' ? null : folderId } : {}),
  }

  const [items, total] = await Promise.all([
    db.page.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      take: limit,
      skip: offset,
    }),
    db.page.count({ where }),
  ])
  return NextResponse.json({ items, total })
}

export async function POST(req: Request) {
  const body = await req.json()
  if (!body?.slug || !body?.title) {
    return NextResponse.json({ error: 'slug and title are required' }, { status: 400 })
  }

  try {
    const page = await createOrRevivePage({
      slug: body.slug,
      title: body.title,
      content: body.content,
      summary: body.summary,
      pageType: body.pageType,
      aliases: body.aliases,
      folderId: body.folderId,
      editSource: body.editSource,
    })
    // 임베딩은 응답을 막지 않는다(fire-and-forget). 실패는 embedPageSafe가 삼킨다.
    void embedPageSafe(page)
    return NextResponse.json(page, { status: 201 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json({ error: `slug already exists: ${body.slug}` }, { status: 409 })
    }
    throw e
  }
}
