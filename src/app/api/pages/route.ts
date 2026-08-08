import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { createOrRevivePage } from '@/lib/pages/save'
import { normalizeSlug } from '@/lib/wiki/slug'
import { embedPageSafe } from '@/lib/pages/embedding'

const MAX_LIMIT = 200

export async function GET(req: Request) {
  const u = new URL(req.url)
  const type = u.searchParams.get('type')
  const folderId = u.searchParams.get('folderId')
  // limit=-1이면 Prisma가 역방향 페이징으로 해석해 정렬이 뒤집힌다(실측) — 하한을 둔다.
  const limit = Math.min(Math.max(Number(u.searchParams.get('limit')) || 50, 1), MAX_LIMIT)
  const offset = Math.max(Number(u.searchParams.get('offset')) || 0, 0)

  const where = {
    deletedAt: null,
    ...(type ? { pageType: type } : {}),
    ...(folderId !== null ? { folderId: folderId === '' ? null : folderId } : {}),
  }

  // 본문(content)은 목록에 필요 없다 — 전량을 실어 보내느라 limit=200에 1.4초,
  // offset이 크면 16초까지 갔다(실측). 목록이 쓰는 필드만 고른다.
  const [items, total] = await Promise.all([
    db.page.findMany({
      where,
      select: {
        id: true,
        slug: true,
        title: true,
        summary: true,
        pageType: true,
        status: true,
        folderId: true,
        sortOrder: true,
        version: true,
        lastEditSource: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      take: limit,
      skip: offset,
    }),
    db.page.count({ where }),
  ])
  return NextResponse.json({ items, total })
}

/** 사람·에이전트가 만들 수 있는 값만. 온톨로지 적재는 이 라우트를 안 쓴다. */
const PAGE_TYPES = new Set(['concept', 'entity', 'synthesis'])
const EDIT_SOURCES = new Set(['user', 'agent', 'revert'])
const MAX_SLUG = 300
/** 본문 상한. 넘으면 Prisma가 터져 500이 됐다(실측 10MB) — 413으로 돌려준다. */
const MAX_CONTENT = 4_000_000

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  if (typeof body?.slug !== 'string' || typeof body?.title !== 'string' || !body.slug || !body.title) {
    return NextResponse.json({ error: 'slug and title are required' }, { status: 400 })
  }
  // slug는 URL 경로에 그대로 들어간다 — 경로 탈출·인코딩 문자를 막는다.
  // (실측: `../../etc/passwd`나 `%2F`가 든 slug가 그대로 생성돼 지울 수도 없었다)
  const slug = normalizeSlug(body.slug)
  if (!slug || slug.length > MAX_SLUG) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 400 })
  }
  if (typeof body.content === 'string' && body.content.length > MAX_CONTENT) {
    return NextResponse.json({ error: 'content too large' }, { status: 413 })
  }
  if (body.pageType !== undefined && !PAGE_TYPES.has(body.pageType)) {
    return NextResponse.json({ error: `unknown pageType: ${body.pageType}` }, { status: 400 })
  }
  if (body.editSource !== undefined && !EDIT_SOURCES.has(body.editSource)) {
    return NextResponse.json({ error: `unknown editSource: ${body.editSource}` }, { status: 400 })
  }
  if (body.aliases !== undefined && !Array.isArray(body.aliases)) {
    return NextResponse.json({ error: 'aliases must be an array' }, { status: 400 })
  }

  try {
    const page = await createOrRevivePage({
      slug,
      title: body.title,
      content: body.content,
      summary: body.summary,
      pageType: body.pageType,
      aliases: body.aliases,
      folderId: body.folderId,
      editSource: body.editSource,
    })
    // 임베딩은 응답을 막지 않는다(fire-and-forget). 실패는 embedPageSafe가 삼킨다.
    void embedPageSafe(page)
    return NextResponse.json(page, { status: 201 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002 중복 / P2003 없는 폴더 참조 — 둘 다 사용자가 고칠 수 있는 입력 문제다.
      if (e.code === 'P2002') {
        return NextResponse.json({ error: `slug already exists: ${slug}` }, { status: 409 })
      }
      if (e.code === 'P2003') {
        return NextResponse.json({ error: 'folder not found' }, { status: 400 })
      }
    }
    // 타입이 어긋난 값(aliases에 문자열 등)은 Prisma 검증에서 걸린다 — 400으로 돌린다.
    if (e instanceof Prisma.PrismaClientValidationError) {
      return NextResponse.json({ error: 'invalid field types' }, { status: 400 })
    }
    throw e
  }
}
