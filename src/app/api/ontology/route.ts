import { NextResponse } from 'next/server'
import { SOURCES, findSource } from '@/lib/ontology/source'
import { importOntology } from '@/lib/ontology/import'
import { db } from '@/lib/db'
import { IMPORT_SOURCE } from '@/lib/ontology/import'

// ejkim 전량(4만+ 개체, 트리플 38만)이 220초 실측 — 여유를 둔다.
export const maxDuration = 600

export async function GET() {
  // 소스별 페이지 수 = 그 소스의 최상위 폴더(name === source.name) 서브트리 안 적재 페이지 수.
  // 경로 캐시 컬럼을 없앴으므로 folderId를 폴더 트리로 접어 센다. 폴더 수는 적어 저렴하다.
  const [folders, counts] = await Promise.all([
    db.folder.findMany({ select: { id: true, name: true, parentId: true } }),
    db.page.groupBy({
      by: ['folderId'],
      where: { deletedAt: null, lastEditSource: IMPORT_SOURCE },
      _count: true,
    }),
  ])

  const countByFolder = new Map<string | null, number>(
    counts.map((c) => [c.folderId, c._count]),
  )
  const childrenOf = new Map<string, string[]>()
  for (const f of folders) {
    if (!f.parentId) continue
    const list = childrenOf.get(f.parentId) ?? []
    list.push(f.id)
    childrenOf.set(f.parentId, list)
  }
  const subtreeCount = (rootId: string): number => {
    let total = countByFolder.get(rootId) ?? 0
    for (const child of childrenOf.get(rootId) ?? []) total += subtreeCount(child)
    return total
  }

  return NextResponse.json({
    sources: SOURCES.map((s) => {
      const root = folders.find((f) => f.parentId === null && f.name === s.name)
      return {
        id: s.id,
        name: s.name,
        url: s.url,
        dataset: s.dataset,
        pages: root ? subtreeCount(root.id) : 0,
      }
    }),
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
    return NextResponse.json(
      await importOntology(source, { limit: body?.limit, prune: body?.prune }),
    )
  } catch (e) {
    // 소스가 죽어도 위키는 그대로다. 실패 사유만 돌려준다.
    return NextResponse.json({ error: (e as Error).message, source: source.id }, { status: 502 })
  }
}
