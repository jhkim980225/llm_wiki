import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const MAX_LIMIT = 100

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = decodeURIComponent((await params).slug)
  const u = new URL(req.url)
  const limit = Math.min(Number(u.searchParams.get('limit')) || 20, MAX_LIMIT)
  const offset = Math.max(Number(u.searchParams.get('offset')) || 0, 0)

  const [items, total] = await Promise.all([
    db.pageRevision.findMany({
      where: { slug },
      orderBy: { version: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.pageRevision.count({ where: { slug } }),
  ])
  return NextResponse.json({ items, total })
}
