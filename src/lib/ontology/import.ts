import { db } from '@/lib/db'
import { buildPages, type BuiltPage } from './build'
import { fetchEntities, fetchEntityCount, fetchLabels, fetchTriples } from './fetch'
import type { OntologySource } from './source'

/**
 * 온톨로지에서 만든 문서임을 표시한다. 재적재는 이 값을 가진 문서만 덮어쓰고,
 * 사람이나 에이전트가 손댄 문서(`user`/`agent`)는 건드리지 않는다.
 */
export const IMPORT_SOURCE = 'ontology'

export type ImportResult = {
  source: string
  entities: number
  triples: number
  created: number
  updated: number
  skipped: number
  /** 이번 적재 결과에 없어 휴지통으로 보낸 이 소스의 온톨로지 문서 수 (부분 적재면 0). */
  pruned: number
  ms: number
}

/**
 * 소스별 폴더를 하나 두고 그 안에 문서를 넣는다. 위키 트리에서 출처가 바로 보인다.
 */
async function ensureFolder(source: OntologySource): Promise<string> {
  const existing = await db.folder.findFirst({ where: { name: source.name, parentId: null } })
  if (existing) return existing.id
  const created = await db.folder.create({ data: { name: source.name } })
  return created.id
}

/**
 * 문서를 한 건씩 저장하면 백링크 동기화가 대상마다 조회를 돌아 수만 건에서 몇 시간이 된다.
 * 여기서는 링크 관계를 메모리에서 전부 계산한 뒤 배치로 밀어넣는다.
 */
export async function importOntology(
  source: OntologySource,
  opts: { limit?: number; prune?: boolean } = {},
): Promise<ImportResult> {
  const started = Date.now()
  const limit = opts.limit ?? 2000

  // 전량 적재 여부는 소스의 실제 개체 수로 판정한다 — limit에 딱 걸리면
  // entities.length < limit 휴리스틱이 영원히 부분 적재로 오판한다 (실측: ejkim 4만 초과).
  const total = await fetchEntityCount(source)
  const entities = await fetchEntities(source, limit)
  const triples = await fetchTriples(
    source,
    entities.map((e) => e.uri),
  )

  // 관계 대상이 이번 슬라이스 밖이면 buildPages가 그 링크를 버린다. 부분 적재에서도
  // 문서가 서로 이어지도록, 밖을 가리키는 대상의 표시명만 더 가져와 문서로 만든다(1홉).
  const fetched = new Set(entities.map((e) => e.uri))
  const missing = [...new Set(triples.filter((t) => !t.literal && !fetched.has(t.o)).map((t) => t.o))]
  const closure = missing.length > 0 ? await fetchLabels(source, missing) : []

  const pages = buildPages(source, [...entities, ...closure], triples)

  // 백링크: 이번 묶음 안에서만 계산한다. 아웃링크의 역방향이 곧 인링크다.
  const inLinks = new Map<string, string[]>()
  for (const p of pages) {
    for (const target of p.outLinks) {
      const list = inLinks.get(target) ?? []
      list.push(p.slug)
      inLinks.set(target, list)
    }
  }

  const folderId = await ensureFolder(source)
  const slugs = pages.map((p) => p.slug)

  // 이미 있는 문서를 한 번에 조회해 덮어쓸지 건너뛸지 판정한다.
  const existing = await db.page.findMany({
    where: { slug: { in: slugs } },
    select: { id: true, slug: true, version: true, lastEditSource: true },
  })
  const known = new Map(existing.map((e) => [e.slug, e]))

  const toCreate: BuiltPage[] = []
  const toUpdate: BuiltPage[] = []
  let skipped = 0

  for (const p of pages) {
    const prev = known.get(p.slug)
    if (!prev) {
      toCreate.push(p)
    } else if (prev.lastEditSource === IMPORT_SOURCE) {
      toUpdate.push(p)
    } else {
      // 사람이 손댄 문서는 덮어쓰지 않는다.
      skipped++
    }
  }

  const row = (p: BuiltPage) => ({
    slug: p.slug,
    title: p.title,
    summary: p.summary,
    content: p.content,
    pageType: p.pageType,
    aliases: p.aliases,
    outLinks: p.outLinks,
    inLinks: inLinks.get(p.slug) ?? [],
    folderId,
    lastEditSource: IMPORT_SOURCE,
  })

  const CHUNK = 500
  for (let i = 0; i < toCreate.length; i += CHUNK) {
    await db.page.createMany({ data: toCreate.slice(i, i + CHUNK).map(row), skipDuplicates: true })
  }

  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const slice = toUpdate.slice(i, i + CHUNK)
    await db.$transaction(
      slice.map((p) => {
        const { slug, ...data } = row(p)
        return db.page.update({ where: { slug }, data: { ...data, deletedAt: null } })
      }),
    )
  }

  // 소급 정리 — 이번 적재 결과에 없는 이 소스의 온톨로지 문서를 휴지통으로 보낸다.
  // (분신 병합으로 사라진 빈 껍데기가 여기서 치워진다. 사람·에이전트 문서는 무관.)
  // 부분 적재(limit에 걸림)면 스냅샷이 불완전하므로 자동 실행하지 않는다.
  let pruned = 0
  const fullSnapshot = entities.length >= total
  if (opts.prune ?? fullSnapshot) {
    const current = await db.page.findMany({
      where: {
        slug: { startsWith: `${source.id}/` },
        lastEditSource: IMPORT_SOURCE,
        deletedAt: null,
      },
      select: { id: true, slug: true },
    })
    const built = new Set(slugs)
    const stale = current.filter((c) => !built.has(c.slug)).map((c) => c.id)
    for (let i = 0; i < stale.length; i += CHUNK) {
      await db.page.updateMany({
        where: { id: { in: stale.slice(i, i + CHUNK) } },
        data: { deletedAt: new Date() },
      })
    }
    pruned = stale.length
  }

  return {
    source: source.id,
    entities: entities.length,
    triples: triples.length,
    created: toCreate.length,
    updated: toUpdate.length,
    skipped,
    pruned,
    ms: Date.now() - started,
  }
}
