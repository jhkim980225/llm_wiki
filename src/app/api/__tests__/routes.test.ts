import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '@/lib/db'

// 라우트 회귀 테스트는 저장 경로만 본다. embed-on-save는 외부 임베딩 백엔드를
// 부르므로 no-op으로 목한다(그 자체는 embed.test.ts에서 검증).
vi.mock('@/lib/pages/embedding', () => ({ embedPageSafe: vi.fn(), updatePageEmbedding: vi.fn() }))

import { POST as createPage } from '@/app/api/pages/route'
import { GET as getPage, PUT as putPage, DELETE as deletePage } from '@/app/api/pages/[slug]/route'
import { POST as movePage } from '@/app/api/pages/[slug]/move/route'
import { POST as createFolder } from '@/app/api/folders/route'
import { PATCH as patchFolder, DELETE as deleteFolder } from '@/app/api/folders/[id]/route'
import { GET as getTree } from '@/app/api/tree/route'
import { GET as search } from '@/app/api/search/route'

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

const seedPage = (slug: string, extra: Record<string, unknown> = {}) =>
  db.page.create({ data: { slug, title: slug, content: '', outLinks: [], inLinks: [], ...extra } })

const mkFolder = async (name: string, parentId: string | null = null) => {
  const res = await createFolder(req('/api/folders', 'POST', { name, parentId }))
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

beforeEach(reset)

describe('POST /api/pages', () => {
  it('생성하면 201과 페이지를 돌려준다', async () => {
    const res = await createPage(req('/api/pages', 'POST', { slug: 'a', title: 'A' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.slug).toBe('a')
    expect(body.title).toBe('A')
  })

  it('slug나 title이 없으면 400', async () => {
    expect((await createPage(req('/api/pages', 'POST', { title: 'A' }))).status).toBe(400)
    expect((await createPage(req('/api/pages', 'POST', { slug: 'a' }))).status).toBe(400)
  })

  it('살아 있는 slug와 겹치면 409', async () => {
    await seedPage('a')
    const res = await createPage(req('/api/pages', 'POST', { slug: 'a', title: 'A' }))
    expect(res.status).toBe(409)
  })

  // 아래는 견고성 감사에서 500이 나던 것들 — 전부 4xx여야 한다
  it('깨진 JSON·빈 바디는 400', async () => {
    const broken = new Request('http://test/api/pages', {
      method: 'POST',
      body: '{oops',
      headers: { 'content-type': 'application/json' },
    })
    expect((await createPage(broken)).status).toBe(400)
    expect((await createPage(req('/api/pages', 'POST'))).status).toBe(400)
  })

  it('slug·title 타입이 문자열이 아니면 400', async () => {
    expect((await createPage(req('/api/pages', 'POST', { slug: 123, title: ['a'] }))).status).toBe(400)
  })

  // 경로 탈출·인코딩 문자가 든 slug가 그대로 생성돼 URL로 지울 수도 없었다
  it('경로 탈출 slug는 정규화해서 받는다', async () => {
    const res = await createPage(req('/api/pages', 'POST', { slug: '../../etc/passwd', title: 'X' }))
    expect(res.status).toBe(201)
    expect((await res.json()).slug).toBe('etc/passwd')
  })

  it('slug가 정규화 후 비면 400', async () => {
    // 특수문자만 든 이름은 normalizeSlug가 통째로 걷어내 빈 문자열이 된다
    expect((await createPage(req('/api/pages', 'POST', { slug: '!!!', title: 'X' }))).status).toBe(400)
    expect((await createPage(req('/api/pages', 'POST', { slug: '   ', title: 'X' }))).status).toBe(400)
  })

  it('알 수 없는 pageType·editSource는 400', async () => {
    expect(
      (await createPage(req('/api/pages', 'POST', { slug: 'a', title: 'A', pageType: 'NOPE' }))).status,
    ).toBe(400)
    expect(
      (await createPage(req('/api/pages', 'POST', { slug: 'b', title: 'B', editSource: 'hacker' }))).status,
    ).toBe(400)
  })

  it('aliases가 배열이 아니면 400', async () => {
    expect(
      (await createPage(req('/api/pages', 'POST', { slug: 'a', title: 'A', aliases: '문자열' }))).status,
    ).toBe(400)
  })

  it('없는 폴더를 가리키면 400', async () => {
    const res = await createPage(
      req('/api/pages', 'POST', {
        slug: 'a',
        title: 'A',
        folderId: '00000000-0000-0000-0000-000000000000',
      }),
    )
    expect(res.status).toBe(400)
  })
})

describe('GET /api/pages/[slug]', () => {
  it('있으면 200', async () => {
    await seedPage('a')
    const res = await getPage(req('/api/pages/a', 'GET'), params({ slug: 'a' }))
    expect(res.status).toBe(200)
    expect((await res.json()).slug).toBe('a')
  })

  it('없으면 404', async () => {
    const res = await getPage(req('/api/pages/x', 'GET'), params({ slug: 'x' }))
    expect(res.status).toBe(404)
  })
})

describe('PUT /api/pages/[slug]', () => {
  it('expectedVersion이 어긋나면 409와 currentVersion', async () => {
    await seedPage('a')
    const res = await putPage(
      req('/api/pages/a', 'PUT', { expectedVersion: 99, content: 'x' }),
      params({ slug: 'a' }),
    )
    expect(res.status).toBe(409)
    expect((await res.json()).currentVersion).toBe(1)
  })
})

describe('DELETE /api/pages/[slug]', () => {
  it('soft delete 후 GET은 404', async () => {
    await seedPage('a')
    const res = await deletePage(req('/api/pages/a', 'DELETE'), params({ slug: 'a' }))
    expect(res.status).toBe(200)
    const after = await getPage(req('/api/pages/a', 'GET'), params({ slug: 'a' }))
    expect(after.status).toBe(404)
    // 행은 남고 deletedAt만 찍힌다
    const row = await db.page.findUnique({ where: { slug: 'a' } })
    expect(row!.deletedAt).not.toBeNull()
  })
})

describe('POST /api/pages/[slug]/move', () => {
  it('folderId로 옮긴다', async () => {
    await seedPage('a', { title: 'A' })
    const f = await mkFolder('AI')
    const res = await movePage(
      req('/api/pages/a/move', 'POST', { folderId: f.id }),
      params({ slug: 'a' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.folderId).toBe(f.id)
  })

  it('존재하지 않는 folderId면 404', async () => {
    await seedPage('a')
    const res = await movePage(
      req('/api/pages/a/move', 'POST', { folderId: '11111111-1111-1111-1111-111111111111' }),
      params({ slug: 'a' }),
    )
    expect(res.status).toBe(404)
  })

  // 빈 바디가 조용히 "루트로 이동"으로 처리됐다(실측)
  it('folderId 필드가 아예 없으면 400', async () => {
    await seedPage('a')
    expect(
      (await movePage(req('/api/pages/a/move', 'POST', {}), params({ slug: 'a' }))).status,
    ).toBe(400)
    expect((await movePage(req('/api/pages/a/move', 'POST'), params({ slug: 'a' }))).status).toBe(400)
  })

  it('folderId: null은 루트 이동으로 받는다', async () => {
    const f = await mkFolder('AI')
    await seedPage('a', { folderId: f.id })
    const res = await movePage(
      req('/api/pages/a/move', 'POST', { folderId: null }),
      params({ slug: 'a' }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).folderId).toBeNull()
  })
})

describe('POST /api/folders + PATCH /api/folders/[id]', () => {
  it('생성 201, parentId로 이동', async () => {
    const a = await mkFolder('a')
    const b = await mkFolder('b')
    const res = await patchFolder(
      req(`/api/folders/${b.id}`, 'PATCH', { parentId: a.id }),
      params({ id: b.id }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).parentId).toBe(a.id)
  })

  it('자손 밑으로 옮기면 순환이라 400', async () => {
    const a = await mkFolder('a')
    const b = await mkFolder('b', a.id)
    const res = await patchFolder(
      req(`/api/folders/${a.id}`, 'PATCH', { parentId: b.id }),
      params({ id: a.id }),
    )
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/folders/[id]', () => {
  it('페이지가 들어 있으면 409', async () => {
    const f = await mkFolder('full')
    await seedPage('a', { folderId: f.id })
    const res = await deleteFolder(req(`/api/folders/${f.id}`, 'DELETE'), params({ id: f.id }))
    expect(res.status).toBe(409)
  })

  it('비어 있으면 휴지통으로 간다 (soft delete)', async () => {
    const f = await mkFolder('empty')
    const res = await deleteFolder(req(`/api/folders/${f.id}`, 'DELETE'), params({ id: f.id }))
    expect(res.status).toBe(200)
    const row = await db.folder.findUnique({ where: { id: f.id } })
    expect(row?.deletedAt).not.toBeNull()
  })
})

describe('GET /api/tree', () => {
  it('루트 레벨 folders/pages를 돌려준다', async () => {
    const f = await mkFolder('AI')
    await seedPage('root-page', { title: '루트문서' })
    const res = await getTree(req('/api/tree', 'GET'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.folders.map((x: { id: string }) => x.id)).toContain(f.id)
    expect(body.pages).toEqual([{ slug: 'root-page', title: '루트문서' }])
    expect(body.hasMore).toBe(false)
  })
})

describe('GET /api/search', () => {
  it('제목 매치가 본문 매치보다 앞에 온다', async () => {
    await seedPage('title-hit', { title: '삼성전자', content: '아무 내용' })
    await seedPage('content-hit', { title: '다른 문서', content: '삼성전자 실적 이야기' })
    const res = await search(req(`/api/search?q=${encodeURIComponent('삼성전자')}`, 'GET'))
    expect(res.status).toBe(200)
    const { items } = await res.json()
    expect(items.map((i: { slug: string }) => i.slug)).toEqual(['title-hit', 'content-hit'])
  })
})
