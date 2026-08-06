import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { savePage, VersionConflictError } from '@/lib/pages/save'
import { embedPageSafe } from '@/lib/pages/embedding'
import { parseOutLinks } from '@/lib/wiki/links'

/** [...slug] 없이 슬래시 포함 slug를 다루기 위해 경로 조각은 URL 인코딩된 채로 온다. */
const decode = (s: string) => decodeURIComponent(s)

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = decode((await params).slug)
  const page = await db.page.findFirst({ where: { slug, deletedAt: null } })
  if (!page) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // 저장된 outLinks 컬럼 대신 본문에서 실시간으로 다시 뽑는다 — 링크 문법이
  // 확장(대괄호 표시명 등)될 때 과거 저장분도 재저장 없이 정확히 판정되게.
  const outLinks = parseOutLinks(page.content)

  // 백링크와 죽은 링크 조회는 서로 독립이라 함께 던진다.
  const [backlinks, existing] = await Promise.all([
    db.page.findMany({
      where: { slug: { in: page.inLinks }, deletedAt: null },
      select: { slug: true, title: true },
    }),
    // 본문이 가리키지만 아직 없는 페이지 — UI가 붉은 링크로 표시한다.
    db.page.findMany({
      where: { slug: { in: outLinks }, deletedAt: null },
      select: { slug: true },
    }),
  ])
  const deadLinks = outLinks.filter((s) => !existing.some((e) => e.slug === s))

  return NextResponse.json({ ...page, outLinks, backlinks, deadLinks })
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = decode((await params).slug)
  const body = await req.json()
  if (typeof body?.expectedVersion !== 'number') {
    return NextResponse.json({ error: 'expectedVersion is required' }, { status: 400 })
  }
  try {
    const saved = await savePage({ ...body, slug })
    // 임베딩은 응답을 막지 않는다(fire-and-forget).
    void embedPageSafe(saved)
    return NextResponse.json(saved)
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
    // 이 페이지가 걸어둔 백링크를 대상에서 걷어낸다(대상마다 하던 N 왕복을 한 방으로).
    // 반대로 이 페이지를 가리키던 링크는 남겨둔다 — 원본 문서에는 여전히 [[slug]]가
    // 있고, UI가 죽은 링크로 표시한다.
    if (page.outLinks.length > 0) {
      await tx.$executeRaw`
        UPDATE "Page" SET "inLinks" = array_remove("inLinks", ${slug})
        WHERE slug = ANY(${page.outLinks}::text[])`
    }
    await tx.page.update({ where: { slug }, data: { deletedAt: new Date() } })
    return true
  })

  if (!deleted) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
