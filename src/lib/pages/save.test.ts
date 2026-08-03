import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { savePage, VersionConflictError } from './save'

const reset = async () => {
  await db.pageRevision.deleteMany()
  await db.page.deleteMany()
}

const seed = (slug: string, content = '') =>
  db.page.create({ data: { slug, title: slug, content, outLinks: [], inLinks: [] } })

describe('savePage', () => {
  beforeEach(reset)

  it('가시 필드가 바뀌면 version이 오른다', async () => {
    await seed('a')
    const r = await savePage({ slug: 'a', expectedVersion: 1, content: '새 본문' })
    expect(r.version).toBe(2)
  })

  it('내용이 같으면 version이 그대로다', async () => {
    await seed('a', '같음')
    const r = await savePage({ slug: 'a', expectedVersion: 1, content: '같음' })
    expect(r.version).toBe(1)
  })

  it('편집 전 상태가 리비전에 남는다', async () => {
    await seed('a', '옛날')
    await savePage({ slug: 'a', expectedVersion: 1, content: '새것' })
    const revs = await db.pageRevision.findMany({ where: { slug: 'a' } })
    expect(revs).toHaveLength(1)
    expect(revs[0].content).toBe('옛날')
    expect(revs[0].version).toBe(1)
  })

  it('version이 어긋나면 충돌로 던진다', async () => {
    await seed('a')
    await expect(savePage({ slug: 'a', expectedVersion: 99, content: 'x' })).rejects.toBeInstanceOf(
      VersionConflictError,
    )
  })

  it('아웃링크가 대상 페이지의 백링크로 반영된다', async () => {
    await seed('a')
    await seed('b')
    await savePage({ slug: 'a', expectedVersion: 1, content: '[[b]] 참조' })
    const b = await db.page.findUnique({ where: { slug: 'b' } })
    expect(b!.inLinks).toEqual(['a'])
  })

  it('링크를 지우면 백링크도 사라진다', async () => {
    await seed('a')
    await seed('b')
    await savePage({ slug: 'a', expectedVersion: 1, content: '[[b]]' })
    await savePage({ slug: 'a', expectedVersion: 2, content: '링크 없음' })
    const b = await db.page.findUnique({ where: { slug: 'b' } })
    expect(b!.inLinks).toEqual([])
  })

  it('존재하지 않는 대상 링크는 저장은 되고 백링크만 안 생긴다', async () => {
    await seed('a')
    const r = await savePage({ slug: 'a', expectedVersion: 1, content: '[[없음]]' })
    expect(r.outLinks).toEqual(['없음'])
  })

  it('editSource가 agent면 그대로 기록된다', async () => {
    await seed('a')
    const r = await savePage({ slug: 'a', expectedVersion: 1, content: 'x', editSource: 'agent' })
    expect(r.lastEditSource).toBe('agent')
  })

  it('같은 링크를 두 번 저장해도 백링크가 중복되지 않는다', async () => {
    await seed('a')
    await seed('b')
    await savePage({ slug: 'a', expectedVersion: 1, content: '[[b]] 하나' })
    await savePage({ slug: 'a', expectedVersion: 2, content: '[[b]] 둘' })
    const b = await db.page.findUnique({ where: { slug: 'b' } })
    expect(b!.inLinks).toEqual(['a'])
  })
})

import { createOrRevivePage } from './save'

describe('createOrRevivePage', () => {
  beforeEach(reset)

  it('새 slug면 그냥 만든다', async () => {
    const p = await createOrRevivePage({ slug: 'new', title: 'New', content: '본문' })
    expect(p.slug).toBe('new')
    expect(p.deletedAt).toBeNull()
  })

  it('삭제된 페이지의 이름으로 다시 만들면 되살아난다', async () => {
    const seeded = await seed('gone', '옛 본문')
    await db.page.update({ where: { id: seeded.id }, data: { deletedAt: new Date() } })

    const revived = await createOrRevivePage({ slug: 'gone', title: '부활', content: '새 본문' })

    expect(revived.id).toBe(seeded.id)
    expect(revived.deletedAt).toBeNull()
    expect(revived.content).toBe('새 본문')
    expect(revived.version).toBe(seeded.version + 1)
  })

  it('되살릴 때 링크도 다시 걸린다', async () => {
    const seeded = await seed('gone')
    await db.page.update({ where: { id: seeded.id }, data: { deletedAt: new Date() } })
    await seed('target')

    await createOrRevivePage({ slug: 'gone', title: '부활', content: '[[target]]' })

    const t = await db.page.findUnique({ where: { slug: 'target' } })
    expect(t!.inLinks).toEqual(['gone'])
  })

  it('살아 있는 slug면 유니크 위반을 던진다', async () => {
    await seed('alive')
    await expect(createOrRevivePage({ slug: 'alive', title: 'X' })).rejects.toThrow()
  })
})

describe('savePage 삭제된 페이지', () => {
  beforeEach(reset)

  it('삭제된 페이지는 편집 대상이 아니다', async () => {
    const seeded = await seed('gone')
    await db.page.update({ where: { id: seeded.id }, data: { deletedAt: new Date() } })
    await expect(
      savePage({ slug: 'gone', expectedVersion: 1, content: 'x' }),
    ).rejects.toThrow(/not found/)
  })
})
