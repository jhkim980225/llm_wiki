import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { proposeLinks } from './linkify'

const reset = async () => {
  await db.pageRevision.deleteMany()
  await db.page.deleteMany()
  await db.graphRef.deleteMany()
}

const seed = (slug: string, title: string) =>
  db.page.create({ data: { slug, title, content: '', outLinks: [], inLinks: [] } })

/** 아직 문서가 없는 그래프 개체. pageSlug는 승격될 자리를 미리 예약해 둔 것이다. */
const seedRef = (name: string, pageSlug: string, sourceId = 'ejkim') =>
  db.graphRef.create({ data: { name, type: 'person', sourceId, pageSlug } })

describe('proposeLinks', () => {
  beforeEach(reset)

  it('본문에 제목이 나오면 첫 출현을 링크로 감싼다', async () => {
    await seed('samsung', '삼성전자')
    await seed('here', '이 문서')

    const r = await proposeLinks('here', '삼성전자는 반도체를 만든다. 삼성전자는 크다.')

    expect(r.changed).toBe(true)
    expect(r.content).toBe('[[samsung|삼성전자]]는 반도체를 만든다. 삼성전자는 크다.')
    expect(r.added).toEqual([{ slug: 'samsung', title: '삼성전자' }])
  })

  it('자기 자신은 후보에서 빠진다', async () => {
    await seed('here', '삼성전자')

    const r = await proposeLinks('here', '삼성전자 이야기')

    expect(r.changed).toBe(false)
    expect(r.added).toEqual([])
  })

  it('3자 미만 제목은 거른다 — 온톨로지 2자 라벨이 아무 데나 걸린다', async () => {
    await seed('sale', '판매')
    await seed('semi', '반도체')
    await seed('here', '이 문서')

    const r = await proposeLinks('here', '반도체 판매가 늘었다')

    expect(r.added).toEqual([{ slug: 'semi', title: '반도체' }])
    expect(r.content).toContain('판매가 늘었다')
  })

  it('제목이 겹치면 어느 쪽인지 정할 수 없어 버린다', async () => {
    await seed('apple-corp', '애플')
    await seed('apple-corp-2', '애플')
    await seed('here', '이 문서')

    const r = await proposeLinks('here', '애플에 대하여')

    expect(r.changed).toBe(false)
    expect(r.added).toEqual([])
  })

  it('제목이 겹쳐도 같은 소스에 하나뿐이면 그것을 고른다', async () => {
    await seed('ejkim/미생물', '미생물')
    await seed('seunghoon/미생물', '미생물')
    await seed('ejkim/here', '이 문서')

    const r = await proposeLinks('ejkim/here', '미생물 연구')

    expect(r.added).toEqual([{ slug: 'ejkim/미생물', title: '미생물' }])
  })

  it('같은 소스에도 동명이 둘이면 여전히 버린다', async () => {
    await seed('ejkim/협회', '무역협회')
    await seed('ejkim/협회-2', '무역협회')
    await seed('ejkim/here', '이 문서')

    const r = await proposeLinks('ejkim/here', '무역협회 이야기')

    expect(r.changed).toBe(false)
  })

  it('대소문자가 다르면 후보로도 안 걸린다 (SQL과 linkifyContent가 같은 술어를 쓴다)', async () => {
    await seed('acme', 'AcmeCorp')
    await seed('here', '이 문서')

    const r = await proposeLinks('here', 'acmecorp is here')

    expect(r.changed).toBe(false)
  })

  it('코드 블록 안은 건드리지 않는다', async () => {
    await seed('semi', '반도체')
    await seed('here', '이 문서')

    const r = await proposeLinks('here', '```\n반도체\n```\n\n반도체 시장')

    expect(r.content).toBe('```\n반도체\n```\n\n[[semi|반도체]] 시장')
  })

  it('이미 걸린 링크는 다시 안 건다', async () => {
    await seed('semi', '반도체')
    await seed('here', '이 문서')

    const r = await proposeLinks('here', '[[semi|반도체]]와 반도체')

    expect(r.changed).toBe(false)
    expect(r.added).toEqual([])
  })

  it('삭제된 문서는 후보가 아니다', async () => {
    await db.page.create({
      data: { slug: 'gone', title: '사라진문서', content: '', deletedAt: new Date() },
    })
    await seed('here', '이 문서')

    const r = await proposeLinks('here', '사라진문서 이야기')

    expect(r.changed).toBe(false)
  })

  // 문서가 없어도 링크를 건다. 클릭하면 문서 없음 화면이 "그래프에서 가져오기"를 띄운다 —
  // 새 링크 문법을 만들지 않는 대신 죽은 링크를 일부러 심는 설계다.
  it('문서가 없는 그래프 개체도 링크 후보다', async () => {
    await seedRef('정아라', 'ejkim/정아라')
    await seed('here', '이 문서')

    const r = await proposeLinks('here', '정아라 연구원이 회신했다')

    expect(r.changed).toBe(true)
    expect(r.added).toEqual([{ slug: 'ejkim/정아라', title: '정아라' }])
  })

  // 적재본이 이미 있으면 그쪽이 본체다. 좁히지 않으면 동명이인으로 보여 링크가 막힌다.
  it('같은 이름이 문서에도 개체에도 있으면 문서를 고른다', async () => {
    await seed('ejkim/정아라', '정아라')
    await seedRef('정아라', 'ejkim/정아라-2', 'seunghoon')
    await seed('here', '이 문서')

    const r = await proposeLinks('here', '정아라 연구원이 회신했다')

    expect(r.added).toEqual([{ slug: 'ejkim/정아라', title: '정아라' }])
  })
})
