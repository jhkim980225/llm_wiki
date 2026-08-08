import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { savePage, VersionConflictError } from '@/lib/pages/save'

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = decodeURIComponent((await params).slug)
  const { version } = await req.json().catch(() => null)
  if (typeof version !== 'number') {
    return NextResponse.json({ error: 'version is required' }, { status: 400 })
  }

  const page = await db.page.findFirst({ where: { slug, deletedAt: null } })
  if (!page) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const rev = await db.pageRevision.findFirst({ where: { pageId: page.id, version } })
  if (!rev) return NextResponse.json({ error: `revision ${version} not found` }, { status: 404 })

  try {
    // 되돌리기도 평범한 편집이다 — 현재 상태가 리비전으로 쌓이고 version이 오른다.
    const updated = await savePage({
      slug,
      expectedVersion: page.version,
      title: rev.title,
      content: rev.content,
      summary: rev.summary,
      pageType: rev.pageType,
      status: rev.status,
      editSource: 'revert',
    })
    return NextResponse.json(updated)
  } catch (e) {
    if (e instanceof VersionConflictError) {
      return NextResponse.json(
        { error: 'version conflict', currentVersion: e.currentVersion },
        { status: 409 },
      )
    }
    throw e
  }
}
