import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '@/lib/db'

vi.mock('@/lib/pages/embedding', () => ({ embedPageSafe: vi.fn(), updatePageEmbedding: vi.fn() }))

import { GET as getTrash, POST as restore, DELETE as emptyTrash } from '@/app/api/trash/route'
import { DELETE as deleteFolder } from '@/app/api/folders/[id]/route'
import { GET as getTree } from '@/app/api/tree/route'
import { RETENTION_DAYS } from '@/lib/trash'

const reset = async () => {
  await db.pageRevision.deleteMany()
  await db.page.deleteMany()
  await db.folder.deleteMany()
}

const req = (url: string, method: string, body?: unknown) =>
  new Request(`http://test${url}`, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
      : {}),
  })

const params = <T extends Record<string, string>>(v: T) => ({ params: Promise.resolve(v) })

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000)

beforeEach(reset)

describe('휴지통', () => {
  it('폴더 삭제는 soft delete고 트리에서 사라진다', async () => {
    const f = await db.folder.create({ data: { name: '빈폴더' } })
    const res = await deleteFolder(req(`/api/folders/${f.id}`, 'DELETE'), params({ id: f.id }))
    expect(res.status).toBe(200)

    const row = await db.folder.findUnique({ where: { id: f.id } })
    expect(row?.deletedAt).not.toBeNull()

    const tree = await (await getTree(req('/api/tree', 'GET'))).json()
    expect(tree.folders).toHaveLength(0)
  })

  it('목록은 문서와 폴더를 최근 삭제 순으로 준다', async () => {
    await db.folder.create({ data: { name: 'f', deletedAt: daysAgo(1) } })
    await db.page.create({ data: { slug: 'p', title: 'P', deletedAt: daysAgo(0) } })

    const body = await (await getTrash()).json()
    expect(body.retentionDays).toBe(RETENTION_DAYS)
    expect(body.items.map((i: { kind: string }) => i.kind)).toEqual(['page', 'folder'])
  })

  it('보존 기한이 지난 것은 목록 조회 때 퍼지된다', async () => {
    await db.page.create({ data: { slug: 'old', title: 'Old', deletedAt: daysAgo(RETENTION_DAYS + 1) } })
    await db.page.create({ data: { slug: 'new', title: 'New', deletedAt: daysAgo(1) } })

    const body = await (await getTrash()).json()
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['new'])
    expect(await db.page.findUnique({ where: { slug: 'old' } })).toBeNull()
  })

  it('문서 복원 — 원래 폴더가 휴지통에 있으면 최상위로 꺼낸다', async () => {
    const f = await db.folder.create({ data: { name: 'f', deletedAt: daysAgo(1) } })
    await db.page.create({ data: { slug: 'p', title: 'P', folderId: f.id, deletedAt: daysAgo(1) } })

    const res = await restore(req('/api/trash', 'POST', { kind: 'page', id: 'p' }))
    expect(res.status).toBe(200)

    const page = await db.page.findUnique({ where: { slug: 'p' } })
    expect(page?.deletedAt).toBeNull()
    expect(page?.folderId).toBeNull()
  })

  it('폴더 복원', async () => {
    const f = await db.folder.create({ data: { name: 'f', deletedAt: daysAgo(1) } })
    const res = await restore(req('/api/trash', 'POST', { kind: 'folder', id: f.id }))
    expect(res.status).toBe(200)
    expect((await db.folder.findUnique({ where: { id: f.id } }))?.deletedAt).toBeNull()
  })

  it('비우기는 기한과 무관하게 전부 지운다', async () => {
    await db.page.create({ data: { slug: 'p', title: 'P', deletedAt: daysAgo(0) } })
    await emptyTrash()
    expect(await db.page.findUnique({ where: { slug: 'p' } })).toBeNull()
  })

  it('휴지통에 없는 것 복원은 404', async () => {
    const res = await restore(req('/api/trash', 'POST', { kind: 'page', id: 'ghost' }))
    expect(res.status).toBe(404)
  })
})
