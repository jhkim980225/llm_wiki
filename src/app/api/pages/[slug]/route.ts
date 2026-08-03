import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { savePage, VersionConflictError } from '@/lib/pages/save'

/** [...slug] 없이 슬래시 포함 slug를 다루기 위해 경로 조각은 URL 인코딩된 채로 온다. */
const decode = (s: string) => decodeURIComponent(s)

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = decode((await params).slug)
  const page = await db.page.findFirst({ where: { slug, deletedAt: null } })
  if (!page) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const backlinks = await db.page.findMany({
    where: { slug: { in: page.inLinks }, deletedAt: null },
    select: { slug: true, title: true },
  })
  // 본문이 가리키지만 아직 없는 페이지 — UI가 붉은 링크로 표시한다.
  const existing = await db.page.findMany({
    where: { slug: { in: page.outLinks }, deletedAt: null },
    select: { slug: true },
  })
  const deadLinks = page.outLinks.filter((s) => !existing.some((e) => e.slug === s))

  return NextResponse.json({ ...page, backlinks, deadLinks })
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = decode((await params).slug)
  const body = await req.json()
  if (typeof body?.expectedVersion !== 'number') {
    return NextResponse.json({ error: 'expectedVersion is required' }, { status: 400 })
  }
  try {
    return NextResponse.json(await savePage({ ...body, slug }))
  } catch (e) {
    if (e instanceof VersionConflictError) {
      return NextResponse.json(
        { error: 'version conflict', currentVersion: e.currentVersion },
        { status: 409 },
      )
    }
    if (e instanceof Error && e.message.startsWith('page not found')) {
      return NextResponse.json({ error: e.message }, { status: 404 })
    }
    throw e
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = decode((await params).slug)
  const deleted = await db.$transaction(async (tx) => {
    const page = await tx.page.findFirst({ where: { slug, deletedAt: null } })
    if (!page) return false
    // 이 페이지가 걸어둔 백링크를 대상에서 걷어낸다. 반대로 이 페이지를 가리키던
    // 링크는 남겨둔다 — 원본 문서에는 여전히 [[slug]]가 있고, UI가 죽은 링크로 표시한다.
    for (const target of page.outLinks) {
      const t = await tx.page.findUnique({ where: { slug: target } })
      if (!t) continue
      await tx.page.update({
        where: { slug: target },
        data: { inLinks: t.inLinks.filter((s) => s !== slug) },
      })
    }
    await tx.page.update({ where: { slug }, data: { deletedAt: new Date() } })
    return true
  })

  if (!deleted) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
