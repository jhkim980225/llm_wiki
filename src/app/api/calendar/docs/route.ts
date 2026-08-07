import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/guard'
import { db } from '@/lib/db'
import { extractDateRange, overlaps } from '@/lib/calendar/dates'

/**
 * 캘린더에 얹을 폴더와 표시 종류. 템플릿 루틴이 저장하는 폴더 이름과 맞춘다.
 * ponytail: 폴더 이름 하드코딩 — 설정 화면이 필요해지면 그때 뺀다.
 */
const FOLDERS: { name: string; kind: 'vacation' | 'weekly' }[] = [
  { name: '휴가신청', kind: 'vacation' },
  { name: '주간업무', kind: 'weekly' },
]

export type CalendarDoc = {
  slug: string
  title: string
  kind: 'vacation' | 'weekly'
  start: string
  end: string
}

/**
 * 휴가신청·주간업무 폴더의 문서에서 기간을 뽑아 돌려준다.
 * 날짜는 문서 제목·본문에서 추출한다(lib/calendar/dates) — 별도 필드를 두지 않아
 * 사람이 직접 쓴 문서도 폴더에만 넣으면 달력에 뜬다.
 *
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD 창과 겹치는 것만 준다.
 */
export async function GET(req: Request) {
  const authed = await requireSession()
  if (!authed) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const u = new URL(req.url)
  const from = u.searchParams.get('from') ?? '0000-01-01'
  const to = u.searchParams.get('to') ?? '9999-12-31'

  const folders = await db.folder.findMany({
    where: { name: { in: FOLDERS.map((f) => f.name) }, deletedAt: null },
    select: { id: true, name: true },
  })
  if (folders.length === 0) return NextResponse.json({ items: [] })

  const kindOf = new Map(FOLDERS.map((f) => [f.name, f.kind]))
  const folderKind = new Map(folders.map((f) => [f.id, kindOf.get(f.name)!]))

  const pages = await db.page.findMany({
    where: { folderId: { in: folders.map((f) => f.id) }, deletedAt: null },
    select: { slug: true, title: true, content: true, folderId: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  const items: CalendarDoc[] = []
  for (const p of pages) {
    // 제목이 우선(주간업무는 제목에 기간이 있다), 없으면 본문에서.
    const range = extractDateRange(p.title) ?? extractDateRange(p.content)
    if (!range || !overlaps(range, from, to)) continue
    items.push({
      slug: p.slug,
      title: p.title,
      kind: folderKind.get(p.folderId!) ?? 'weekly',
      start: range.start,
      end: range.end,
    })
  }
  return NextResponse.json({ items })
}
