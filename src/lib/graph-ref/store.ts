/**
 * GraphRef 저장·해석·승격. I/O를 담당하는 층이고, 계산은 전부 옆의 순수 모듈에 있다
 * (sparql.ts·graph.ts·content.ts).
 *
 * 흐름:
 *   upsertRef  — 개체 참조를 쌓는다(문서는 아직 안 만든다)
 *   loadEgo    — 그래프에서 1홉 이웃을 끌어온다
 *   promoteRef — 그 결과로 위키 문서를 만든다
 */
import { db } from '@/lib/db'
import { entitySlug } from '@/lib/ontology/build'
import { query } from '@/lib/ontology/fetch'
import { SOURCES, type OntologySource } from '@/lib/ontology/source'
import { createOrRevivePage } from '@/lib/pages/save'
import { buildEntityContent } from './content'
import { buildEgo, type EgoOptions, type EgoResult } from './graph'
import { assertReadOnly, enforceLimit, labelLookupQuery, neighborQuery } from './sparql'

export type GraphRefRow = {
  id: string
  name: string
  type: string
  sourceId: string
  uri: string | null
  sparql: string
  pageSlug: string
  promoted: boolean
}

const SELECT = {
  id: true,
  name: true,
  type: true,
  sourceId: true,
  uri: true,
  sparql: true,
  pageSlug: true,
  promoted: true,
} as const

export function sourceById(id: string): OntologySource {
  const s = SOURCES.find((x) => x.id === id)
  if (!s) throw new Error(`알 수 없는 소스: ${id}`)
  return s
}

export async function findRefByName(name: string): Promise<GraphRefRow | null> {
  return db.graphRef.findFirst({ where: { name }, select: SELECT, orderBy: { createdAt: 'asc' } })
}

export async function findRefBySlug(pageSlug: string): Promise<GraphRefRow | null> {
  return db.graphRef.findFirst({ where: { pageSlug }, select: SELECT })
}

export type UpsertInput = {
  name: string
  type: string
  sourceId: string
  uri?: string | null
  sparql?: string
}

/**
 * 개체 참조를 쌓는다. 이미 있으면 lastSeenAt만 갱신하고 나머지는 덮지 않는다 —
 * 사람이 승격해 둔 문서를 나중 응답이 되돌리면 안 된다. uri만은 비어 있을 때 채운다
 * (라벨 조회를 다시 안 하기 위해서).
 */
export async function upsertRef(input: UpsertInput): Promise<GraphRefRow> {
  const source = sourceById(input.sourceId)
  const pageSlug = entitySlug(source, input.name, input.uri ?? '')

  const existing = await db.graphRef.findUnique({
    where: { sourceId_name: { sourceId: input.sourceId, name: input.name } },
    select: SELECT,
  })

  if (existing) {
    return db.graphRef.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: new Date(),
        ...(existing.uri ? {} : { uri: input.uri ?? null }),
      },
      select: SELECT,
    })
  }

  return db.graphRef.create({
    data: {
      name: input.name,
      type: input.type,
      sourceId: input.sourceId,
      uri: input.uri ?? null,
      sparql: input.sparql ?? '',
      pageSlug,
    },
    select: SELECT,
  })
}

/**
 * uri가 없으면 표시명으로 그래프에 물어 채운다. 여러 건이면 결정적인 첫 건을 쓰되
 * 몇 건이었는지 함께 돌려준다 — 승격된 문서에 "동명 후보 N건" 경고를 남기기 위해서다.
 * 조용히 다른 개체를 보여주는 것이 제일 나쁘다.
 */
export async function resolveUri(
  ref: GraphRefRow,
): Promise<{ uri: string; ambiguousCount: number }> {
  if (ref.uri) return { uri: ref.uri, ambiguousCount: 1 }

  const source = sourceById(ref.sourceId)
  const rows = await query(source, labelLookupQuery(source, ref.name))
  const uris = rows.map((r) => r.s?.value).filter((v): v is string => Boolean(v))
  if (uris.length === 0) throw new Error(`그래프에서 "${ref.name}"을(를) 찾지 못했습니다`)

  const uri = uris[0]
  // 임시 참조(적재본 문서에서 즉석으로 만든 것 — id 없음)는 저장할 행이 없다.
  if (ref.id) await db.graphRef.update({ where: { id: ref.id }, data: { uri } })
  return { uri, ambiguousCount: uris.length }
}

/**
 * GraphRef 행이 없어도 적재본 개체 문서라면 즉석 참조를 만든다.
 * 온톨로지 적재본은 전부 그래프의 개체이므로, 대화에 등장했는지(GraphRef 유무)와
 * 무관하게 개체 그래프를 볼 수 있어야 한다 — kakao/정아라에서 실측된 요구.
 */
export async function refForSlug(pageSlug: string): Promise<GraphRefRow | null> {
  const found = await findRefBySlug(pageSlug)
  if (found) return found

  const cut = pageSlug.indexOf('/')
  if (cut < 0) return null
  const sourceId = pageSlug.slice(0, cut)
  if (!SOURCES.some((s) => s.id === sourceId)) return null

  const page = await db.page.findFirst({
    where: { slug: pageSlug, deletedAt: null, pageType: 'entity' },
    select: { title: true },
  })
  if (!page) return null

  return {
    id: '', // 저장 안 된 임시 참조 표시 — resolveUri가 uri 기록을 건너뛴다
    name: page.title,
    type: 'entity',
    sourceId,
    uri: null,
    sparql: '',
    pageSlug,
    promoted: true,
  }
}

/**
 * 저장된 sparql이 있으면 그것을, 없으면 템플릿을 써서 1홉 이웃을 가져온다.
 * 저장된 것은 외부(LLM)가 만들었을 수 있으므로 반드시 검사를 통과시킨다.
 */
export async function loadEgo(
  ref: GraphRefRow,
  opts: EgoOptions = {},
): Promise<{ ego: EgoResult; uri: string; ambiguousCount: number }> {
  const source = sourceById(ref.sourceId)
  const { uri, ambiguousCount } = await resolveUri(ref)

  let sparql: string
  if (ref.sparql.trim()) {
    assertReadOnly(ref.sparql)
    sparql = enforceLimit(ref.sparql)
  } else {
    sparql = neighborQuery(source, uri)
  }

  const rows = await query(source, sparql)
  return { ego: buildEgo(source, { uri, label: ref.name }, rows, opts), uri, ambiguousCount }
}

/** 소스별 폴더. import.ts의 ensureFolder와 같은 규칙이라 같은 폴더로 떨어진다. */
async function ensureFolder(source: OntologySource): Promise<string> {
  const existing = await db.folder.findFirst({ where: { name: source.name, parentId: null } })
  if (existing) return existing.id
  const created = await db.folder.create({ data: { name: source.name } })
  return created.id
}

/**
 * 그래프에서 끌어와 위키 문서로 만든다.
 *
 * editSource는 'agent'다 — 'ontology'가 아니다. 재적재 prune이 "이번 결과에 없는
 * ontology 문서"를 휴지통으로 보내는데(import.ts), 대화에서 나온 개체가 거기 휩쓸리면
 * 안 된다. 'agent'라서 재적재가 이 문서를 덮지도 않는다.
 */
export async function promoteRef(ref: GraphRefRow): Promise<{ slug: string; created: boolean }> {
  const source = sourceById(ref.sourceId)

  const existing = await db.page.findFirst({
    where: { slug: ref.pageSlug, deletedAt: null },
    select: { id: true },
  })
  if (existing) {
    if (!ref.promoted) {
      await db.graphRef.update({ where: { id: ref.id }, data: { promoted: true } })
    }
    return { slug: ref.pageSlug, created: false }
  }

  const { ego, ambiguousCount } = await loadEgo(ref)
  const built = buildEntityContent({
    sourceId: ref.sourceId,
    name: ref.name,
    type: ref.type,
    attrs: ego.attrs,
    neighbors: ego.neighbors,
    ambiguousCount,
  })

  await createOrRevivePage({
    slug: ref.pageSlug,
    title: ref.name,
    content: built.content,
    summary: built.summary,
    pageType: 'entity',
    folderId: await ensureFolder(source),
    editSource: 'agent',
  })

  await db.graphRef.update({ where: { id: ref.id }, data: { promoted: true } })
  return { slug: ref.pageSlug, created: true }
}
