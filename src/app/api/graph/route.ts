import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computeGraphSubset } from '@/lib/graph/subset'

const DEFAULT_LIMIT = 500
const MAX_LIMIT = 2000
const DEFAULT_DEPTH = 1
const MAX_DEPTH = 3

const clamp = (raw: string | null, def: number, max: number) => {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : def
}

export async function GET(req: Request) {
  const u = new URL(req.url)

  const pages = await db.page.findMany({
    where: { deletedAt: null },
    select: { slug: true, title: true, pageType: true, inLinks: true, outLinks: true },
  })

  try {
    const result = computeGraphSubset(pages, {
      mode: u.searchParams.get('mode') === 'ego' ? 'ego' : 'overview',
      center: u.searchParams.get('center') ?? undefined,
      depth: clamp(u.searchParams.get('depth'), DEFAULT_DEPTH, MAX_DEPTH),
      types: u.searchParams.get('types')?.split(',').filter(Boolean) ?? [],
      limit: clamp(u.searchParams.get('limit'), DEFAULT_LIMIT, MAX_LIMIT),
    })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
