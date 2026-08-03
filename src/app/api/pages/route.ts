import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { parseOutLinks } from '@/lib/wiki/links'
import { syncBacklinks } from '@/lib/pages/save'

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

  const content: string = body.content ?? ''
  const outLinks = parseOutLinks(content)

  try {
    const page = await db.$transaction(async (tx) => {
      const created = await tx.page.create({
        data: {
          slug: body.slug,
          title: body.title,
          content,
          summary: body.summary ?? '',
          pageType: body.pageType ?? 'concept',
          aliases: body.aliases ?? [],
          folderId: body.folderId ?? null,
          outLinks,
          lastEditSource: body.editSource ?? 'user',
        },
      })
      await syncBacklinks(tx, created.slug, [], outLinks)
      return created
    })
    return NextResponse.json(page, { status: 201 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return NextResponse.json({ error: `slug already exists: ${body.slug}` }, { status: 409 })
    }
    throw e
  }
}
