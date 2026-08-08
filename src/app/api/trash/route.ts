import { NextResponse } from 'next/server'
import { listTrash, purgeExpired, restoreFolder, restorePage, RETENTION_DAYS } from '@/lib/trash'

/** 휴지통 목록. 부를 때마다 기한 지난 것을 먼저 퍼지한다 (lazy purge). */
export async function GET() {
  const purged = await purgeExpired()
  const items = await listTrash()
  return NextResponse.json({ items, retentionDays: RETENTION_DAYS, purged })
}

/** 복원. body: { kind: 'page'|'folder', id: string } */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const kind: unknown = body?.kind
  const id: unknown = body?.id
  if ((kind !== 'page' && kind !== 'folder') || typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'kind(page|folder) and id are required' }, { status: 400 })
  }
  const restored = kind === 'page' ? await restorePage(id) : await restoreFolder(id)
  if (!restored) return NextResponse.json({ error: 'not found in trash' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

/** 휴지통 비우기 — 기한과 무관하게 전부 영구 삭제. */
export async function DELETE() {
  const purged = await purgeExpired(new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000 + 1000))
  return NextResponse.json({ ok: true, purged })
}
