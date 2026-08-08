import { NextResponse } from 'next/server'
import { MAX_CONTENT, proposeLinks } from '@/lib/pages/linkify'

/**
 * 편집기의 미저장 본문을 받아 [[링크]]를 숙인 결과를 돌려준다. 저장하지 않는다.
 * body: { content: string } → { content, changed, added }
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = decodeURIComponent((await params).slug)
  const body = await req.json().catch(() => null)
  const content: unknown = body?.content

  if (typeof content !== 'string') {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }
  if (content.length > MAX_CONTENT) {
    return NextResponse.json(
      { error: `content too long: ${content.length} > ${MAX_CONTENT}` },
      { status: 400 },
    )
  }

  return NextResponse.json(await proposeLinks(slug, content))
}
