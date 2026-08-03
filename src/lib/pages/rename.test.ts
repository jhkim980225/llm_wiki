import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { renamePage } from './rename'

beforeEach(async () => {
  await db.pageRevision.deleteMany()
  await db.page.deleteMany()
})

describe('renamePage', () => {
  it('참조하던 페이지의 본문 링크를 새 slug로 고친다', async () => {
    await db.page.create({ data: { slug: 'old', title: 'Old', outLinks: [], inLinks: ['ref'] } })
    await db.page.create({
      data: { slug: 'ref', title: 'Ref', content: '[[old|옛이름]]', outLinks: ['old'], inLinks: [] },
    })

    const r = await renamePage('old', 'new')

    expect(r.rewritten).toBe(1)
    const ref = await db.page.findUnique({ where: { slug: 'ref' } })
    expect(ref!.content).toBe('[[new|옛이름]]')
    expect(ref!.outLinks).toEqual(['new'])
  })

  it('가리키던 대상의 백링크에도 새 이름이 반영된다', async () => {
    await db.page.create({ data: { slug: 'old', title: 'Old', outLinks: ['t'], inLinks: [] } })
    await db.page.create({ data: { slug: 't', title: 'T', outLinks: [], inLinks: ['old'] } })

    await renamePage('old', 'new')

    const t = await db.page.findUnique({ where: { slug: 't' } })
    expect(t!.inLinks).toEqual(['new'])
  })

  it('새 slug가 이미 있으면 던진다', async () => {
    await db.page.create({ data: { slug: 'a', title: 'A', outLinks: [], inLinks: [] } })
    await db.page.create({ data: { slug: 'b', title: 'B', outLinks: [], inLinks: [] } })
    await expect(renamePage('a', 'b')).rejects.toThrow(/exists/)
  })

  it('링크 재작성은 참조 페이지의 version을 올리지 않는다', async () => {
    await db.page.create({ data: { slug: 'old', title: 'Old', outLinks: [], inLinks: ['ref'] } })
    await db.page.create({
      data: { slug: 'ref', title: 'Ref', content: '[[old]]', outLinks: ['old'], inLinks: [] },
    })

    await renamePage('old', 'new')

    const ref = await db.page.findUnique({ where: { slug: 'ref' } })
    expect(ref!.version).toBe(1)
  })
})
