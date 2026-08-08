import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * 문서 하나를 다른 폴더로 옮긴다. body: { folderId: string | null }
 *
 * folderId만 바꾼다. 경로는 folderId에서 온디맨드로 유도하므로 캐시 컬럼이 없다.
 * version도 올리지 않는다 (장부성 쓰기).
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = decodeURIComponent((await params).slug)
  const body = await req.json().catch(() => null)
  // 루트로 옮기는 것도 정상 동작이라 null은 받되, 필드 자체가 없으면 실수로 본다 —
  // 빈 바디가 조용히 루트 이동으로 처리됐다(실측).
  if (!body || !('folderId' in body)) {
    return NextResponse.json({ error: 'folderId is required (null for root)' }, { status: 400 })
  }
  const folderId: string | null = body.folderId ?? null

  const page = await db.page.findFirst({ where: { slug, deletedAt: null } })
  if (!page) return NextResponse.json({ error: `page not found: ${slug}` }, { status: 404 })

  if (folderId && !(await db.folder.findFirst({ where: { id: folderId, deletedAt: null } }))) {
    return NextResponse.json({ error: `folder not found: ${folderId}` }, { status: 404 })
  }

  const moved = await db.page.update({
    where: { slug },
    data: { folderId },
  })
  return NextResponse.json(moved)
}
