import { NextResponse } from 'next/server'
import { SOURCES, findSource } from '@/lib/ontology/source'
import { importOntology } from '@/lib/ontology/import'
import { db } from '@/lib/db'
import { IMPORT_SOURCE } from '@/lib/ontology/import'

export const maxDuration = 300

export async function GET() {
  const counts = await db.page.groupBy({
    by: ['categoryPath'],
    where: { deletedAt: null, lastEditSource: IMPORT_SOURCE },
    _count: true,
  })
  return NextResponse.json({
    sources: SOURCES.map((s) => ({
      id: s.id,
      name: s.name,
      url: s.url,
      dataset: s.dataset,
      pages: counts.find((c) => c.categoryPath[0] === s.name)?._count ?? 0,
    })),
  })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const source = findSource(body?.source ?? '')
  if (!source) {
    return NextResponse.json(
      { error: `unknown source; try one of ${SOURCES.map((s) => s.id).join(', ')}` },
      { status: 400 },
    )
  }

  try {
    return NextResponse.json(await importOntology(source, { limit: body?.limit }))
  } catch (e) {
    // 소스가 죽어도 위키는 그대로다. 실패 사유만 돌려준다.
    return NextResponse.json({ error: (e as Error).message, source: source.id }, { status: 502 })
  }
}
