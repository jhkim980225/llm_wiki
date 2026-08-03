import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const MAX_LIMIT = 50

export async function GET(req: Request) {
  const u = new URL(req.url)
  const q = (u.searchParams.get('q') ?? '').trim()
  const limit = Math.min(Number(u.searchParams.get('limit')) || 20, MAX_LIMIT)
  if (!q) return NextResponse.json({ items: [] })

  // ponytail: ILIKE 스캔이다. 페이지가 수만 건으로 늘면 tsvector 인덱스로 바꾼다.
  const items = await db.page.findMany({
    where: {
      deletedAt: null,
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { summary: { contains: q, mode: 'insensitive' } },
        { content: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { slug: true, title: true, summary: true, pageType: true },
    take: limit,
  })
  return NextResponse.json({ items })
}
