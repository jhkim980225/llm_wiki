import { NextResponse } from 'next/server'
import { searchEntities } from '@/lib/fuseki/client'

const MAX_LABELS = 200

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('labels') ?? ''
  const labels = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_LABELS)

  try {
    return NextResponse.json(await searchEntities(labels))
  } catch (e) {
    // 위키 레이어는 계속 살아 있어야 한다. 200으로 빈 결과 + 사유를 준다.
    return NextResponse.json({ nodes: [], edges: [], error: (e as Error).message })
  }
}
