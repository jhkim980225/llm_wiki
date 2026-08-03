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
