import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { wouldCycle, folderPath, recomputePagePaths } from './tree'

beforeEach(async () => {
  await db.pageRevision.deleteMany()
  await db.page.deleteMany()
  await db.folder.deleteMany()
})

const mkFolder = (id: string, name: string, parentId: string | null = null) =>
  db.folder.create({ data: { id, name, parentId } })

describe('wouldCycle', () => {
  it('자기 자신을 부모로 삼으면 순환', async () => {
    await mkFolder('11111111-1111-1111-1111-111111111111', 'a')
    expect(await wouldCycle('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111')).toBe(true)
  })

  it('자기 자손을 부모로 삼으면 순환', async () => {
    const a = '11111111-1111-1111-1111-111111111111'
    const b = '22222222-2222-2222-2222-222222222222'
    const c = '33333333-3333-3333-3333-333333333333'
    await mkFolder(a, 'a')
    await mkFolder(b, 'b', a)
    await mkFolder(c, 'c', b)
    expect(await wouldCycle(a, c)).toBe(true)
  })

  it('형제로 옮기는 건 순환이 아니다', async () => {
    const a = '11111111-1111-1111-1111-111111111111'
    const b = '22222222-2222-2222-2222-222222222222'
    await mkFolder(a, 'a')
    await mkFolder(b, 'b')
    expect(await wouldCycle(a, b)).toBe(false)
  })

  it('루트로 옮기는 건 순환이 아니다', async () => {
    const a = '11111111-1111-1111-1111-111111111111'
    await mkFolder(a, 'a')
    expect(await wouldCycle(a, null)).toBe(false)
  })
})

describe('folderPath', () => {
  it('루트부터 이름 체인을 만든다', async () => {
    const a = '11111111-1111-1111-1111-111111111111'
    const b = '22222222-2222-2222-2222-222222222222'
    await mkFolder(a, 'AI')
    await mkFolder(b, 'RAG', a)
    expect(await folderPath(b)).toEqual(['AI', 'RAG'])
  })

  it('루트는 빈 배열', async () => {
    expect(await folderPath(null)).toEqual([])
  })
})

describe('recomputePagePaths', () => {
  it('폴더의 페이지에 categoryPath와 depth를 다시 새긴다', async () => {
    const a = '11111111-1111-1111-1111-111111111111'
    await mkFolder(a, 'AI')
    await db.page.create({ data: { slug: 'p', title: 'P', folderId: a, outLinks: [], inLinks: [] } })

    await recomputePagePaths(a)

    const p = await db.page.findUnique({ where: { slug: 'p' } })
    expect(p!.categoryPath).toEqual(['AI'])
    expect(p!.depth).toBe(1)
    expect(p!.wikiPath).toBe('AI/P')
  })
})
