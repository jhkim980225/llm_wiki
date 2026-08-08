import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { savePage, VersionConflictError } from '@/lib/pages/save'
import { embedPageSafe } from '@/lib/pages/embedding'
import { parseOutLinks } from '@/lib/wiki/links'

/** [...slug] 없이 슬래시 포함 slug를 다루기 위해 경로 조각은 URL 인코딩된 채로 온다. */
const decode = (s: string) => decodeURIComponent(s)

/** 백링크 목록 상한. 적재 개체는 백링크가 수천 건이라(정아라 실측 6,186) 전량 응답·렌더가 초 단위로 는다. */
const MAX_BACKLINKS = 200

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = decode((await params).slug)
  const page = await db.page.findFirst({ where: { slug, deletedAt: null } })
  if (!page) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // 저장된 outLinks 컬럼 대신 본문에서 실시간으로 다시 뽑는다 — 링크 문법이
  // 확장(대괄호 표시명 등)될 때 과거 저장분도 재저장 없이 정확히 판정되게.
  const outLinks = parseOutLinks(page.content)

  // slug 개별 lookup은 행이 커서(본문 TOAST) 개당 ~0.3ms — 6천 개면 그것만 2초다(실측).
  // 그래서 수천 개짜리 IN을 절대 만들지 않는다:
  //  - 백링크 목록: 앞 MAX_BACKLINKS개만 조회 (전량 정렬 후 자르기 금지)
  //  - 백링크 총수: inLinks.length (삭제분 포함 근사 — 카운트에 2초 낼 가치 없음)
  //  - 죽은 링크: 온톨로지 문서는 계산 생략. buildPages가 실존 대상만 링크로
  //    만들므로(대상 없으면 평문) 보장이 이미 있다. 재적재 prune으로 일부가
  //    휴지통에 가면 파란 링크가 문서 없음 화면으로 떨어지는 오차는 감수한다.
  //    사람·에이전트 문서는 링크가 수십 개라 기존 계산이 싸다.
  const skipDead = page.lastEditSource === 'ontology'
  const [backlinks, existing, refs] = await Promise.all([
    db.page.findMany({
      where: { slug: { in: page.inLinks.slice(0, MAX_BACKLINKS) }, deletedAt: null },
      select: { slug: true, title: true },
      orderBy: { title: 'asc' },
    }),
    // 본문이 가리키지만 아직 없는 페이지 — UI가 붉은 링크로 표시한다.
    skipDead
      ? Promise.resolve(null)
      : db.page.findMany({
          where: { slug: { in: outLinks }, deletedAt: null },
          select: { slug: true },
        }),
    // 본문 링크 중 그래프 개체(GraphRef)인 것 — 화면이 타입 배지(인물·조직…)를 단다.
    // GraphRef는 수십~수백 행이라 전량을 가져와 앱에서 교집합을 계산한다
    // (outLinks 수천 개짜리 IN을 다시 만들지 않기 위해 — 위 4초 사건과 같은 이유).
    db.graphRef.findMany({ select: { pageSlug: true, type: true } }),
  ])
  let deadLinks: string[] = []
  if (existing) {
    const existingSet = new Set(existing.map((e) => e.slug))
    deadLinks = outLinks.filter((s) => !existingSet.has(s))
  }
  const backlinkTotal = page.inLinks.length

  const outSet = new Set(outLinks)
  const entityLinks = refs
    .filter((r) => outSet.has(r.pageSlug))
    .map((r) => ({ slug: r.pageSlug, type: r.type }))

  // inLinks(수천 개 배열)는 화면이 안 쓴다 — backlinks로 대체된 원본이라 응답에서 뺀다.
  const { inLinks: _inLinks, ...rest } = page
  return NextResponse.json({ ...rest, outLinks, backlinks, backlinkTotal, deadLinks, entityLinks })
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = decode((await params).slug)
  const body = await req.json().catch(() => null)
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
