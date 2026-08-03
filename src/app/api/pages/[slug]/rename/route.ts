import { NextResponse } from 'next/server'
import { renamePage } from '@/lib/pages/rename'
import { normalizeSlug } from '@/lib/wiki/slug'

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const oldSlug = decodeURIComponent((await params).slug)
  const body = await req.json()
  const newSlug = normalizeSlug(body?.newSlug ?? '')
  if (!newSlug) return NextResponse.json({ error: 'newSlug is required' }, { status: 400 })

  try {
    return NextResponse.json(await renamePage(oldSlug, newSlug))
  } catch (e) {
    const msg = (e as Error).message
    const status = msg.includes('already exists') ? 409 : msg.includes('not found') ? 404 : 500
    if (status === 500) throw e
    return NextResponse.json({ error: msg }, { status })
  }
}
