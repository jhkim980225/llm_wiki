import { QUERY_SOURCES, type OntologySource } from '@/lib/ontology/source'

export type EntityNode = { uri: string; label: string; source: string }
export type EntityEdge = { source: string; target: string; relation: string; from: string }
export type SourceStatus = {
  id: string
  name: string
  ok: boolean
  /** 라벨로 못 찾아 리터럴까지 뒤졌는지. 느린 경로라 호출자가 알아야 한다. */
  searchedText?: boolean
  error?: string
}
export type GraphResult = {
  nodes: EntityNode[]
  edges: EntityEdge[]
  textHits: TextHit[]
  sources: SourceStatus[]
}

type Binding = Record<string, { type: string; value: string }>

/**
 * SPARQL 이중따옴표 리터럴 안에서 안전하도록 이스케이프한다.
 * 사용자 입력이 그대로 질의 문자열에 들어가므로 이걸 건너뛰면 SPARQL 인젝션이다.
 */
export function escapeLiteral(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

/**
 * 소스마다 데이터를 기본 그래프에 두기도 하고 named graph에 두기도 한다
 * (승훈=기본, ejkim·kakao=named). 어느 쪽이든 잡히도록 합집합으로 묶는다.
 *
 * 한 질의에서 두 번 쓸 때는 그래프 변수를 반드시 다르게 줘야 한다. 같은 이름을 쓰면
 * 두 패턴이 "같은 named graph 안에" 있을 것을 요구하게 된다 — ejkim은 본문과 라벨이
 * 서로 다른 그래프에 있어서, 그렇게 하면 라벨이 통째로 안 잡힌다.
 */
const anyGraph = (pattern: string, g = '?__g') =>
  `{ ${pattern} } UNION { GRAPH ${g} { ${pattern} } }`

/** 대화 중 호출이라 적재(120초)보다 훨씬 짧게 끊는다. */
const QUERY_TIMEOUT = 15_000

/** 리터럴 전체 스캔은 인덱스가 없어 느리다 — 실측 ejkim 13초. 여기만 넉넉히 준다. */
const TEXT_TIMEOUT = 30_000

/**
 * 한 소스에서 리터럴까지 뒤질 용어 수 상한.
 *
 * 전체 스캔이라 하나에 십수 초다. 용어가 늘어난 만큼 그대로 곱해지므로 막아 둔다.
 * 라벨로 못 찾은 용어 중 앞의 것부터 쓴다 — 용어 추출이 구체적인 말을 먼저 준다.
 */
const MAX_TEXT_TERMS = 2

/**
 * 죽은 소스를 건너뛰는 시간.
 *
 * 죽은 소스는 TCP 연결이 끊길 때까지 기다리느라 호출마다 10초 넘게 먹는다(실측 kakao 10.5초).
 * AbortSignal은 응답 대기에만 걸려서 이걸 못 줄인다. 한 번 실패하면 잠깐 쉬었다 다시 본다.
 */
const COOLDOWN = 60_000
const failedAt = new Map<string, number>()

/** 아직 쉬는 중인지. 남은 시간을 주면 호출자가 이유를 설명할 수 있다. */
function cooling(id: string, now: number): number {
  const at = failedAt.get(id)
  if (at === undefined) return 0
  const left = COOLDOWN - (now - at)
  if (left <= 0) {
    failedAt.delete(id)
    return 0
  }
  return left
}

/** 테스트와 수동 재시도용. 차단기를 즉시 푼다. */
export function resetBreaker(id?: string): void {
  if (id) failedAt.delete(id)
  else failedAt.clear()
}

async function query(
  source: OntologySource,
  sparql: string,
  timeout = QUERY_TIMEOUT,
): Promise<Binding[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/sparql-query',
    Accept: 'application/sparql-results+json',
  }
  if (source.user) {
    headers.Authorization =
      'Basic ' + Buffer.from(`${source.user}:${source.password ?? ''}`).toString('base64')
  }

  // Fuseki의 읽기 엔드포인트는 /{dataset}/sparql 이다. /query 는 405를 준다.
  const url = `${source.url.replace(/\/+$/, '')}/${source.dataset}/sparql`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: sparql,
    signal: AbortSignal.timeout(timeout),
  })
  if (!res.ok) throw new Error(`${source.id}: SPARQL ${res.status}`)
  const body = (await res.json()) as { results: { bindings: Binding[] } }
  return body.results.bindings
}

/** 한 소스에서 라벨에 검색어가 포함된 개체와 그 관계 엣지를 가져온다. */
export async function searchEntities(
  labels: string[],
  source: OntologySource,
  limit = 60,
): Promise<{ nodes: EntityNode[]; edges: EntityEdge[] }> {
  const terms = labels.filter(Boolean)
  if (terms.length === 0) return { nodes: [], edges: [] }

  const conds = terms.flatMap((t) => {
    const lit = escapeLiteral(t)
    return [`CONTAINS(?sl, "${lit}")`, `CONTAINS(?ol, "${lit}")`]
  })
  const pattern =
    `?s ?p ?o . ` +
    `?s <${source.labelPredicate}> ?sl . ` +
    `?o <${source.labelPredicate}> ?ol .`

  const rows = await query(
    source,
    `SELECT DISTINCT ?s ?sl ?p ?o ?ol WHERE {
       ${anyGraph(pattern)}
       FILTER(STRSTARTS(STR(?p), "${escapeLiteral(source.relationNamespace)}"))
       FILTER(${conds.join(' || ')})
     } LIMIT ${Math.max(1, Math.floor(limit))}`,
  )

  const nodes = new Map<string, EntityNode>()
  const edges: EntityEdge[] = []
  for (const b of rows) {
    if (!nodes.has(b.s.value)) {
      nodes.set(b.s.value, { uri: b.s.value, label: b.sl.value, source: source.id })
    }
    if (!nodes.has(b.o.value)) {
      nodes.set(b.o.value, { uri: b.o.value, label: b.ol.value, source: source.id })
    }
    edges.push({
      source: b.s.value,
      target: b.o.value,
      relation: b.p.value.slice(source.relationNamespace.length),
      from: source.id,
    })
  }
  return { nodes: [...nodes.values()], edges }
}

/** 리터럴 검색이 돌려주는 한 건. 어디에 걸렸는지 보여주려고 조각을 함께 준다. */
export type TextHit = {
  uri: string
  label: string
  snippet: string
  predicate: string
  source: string
}

/** 조각 길이. 근거로 보여줄 만큼만 — 문서 전문이 통째로 오면 컨텍스트가 터진다. */
const SNIPPET = 300

/**
 * 리터럴 값 안에서 검색어를 찾는다.
 *
 * 라벨 검색으로는 안 잡히는 것들이 여기 있다. "글리세롤"은 어느 소스에서도
 * 개체 이름이 아니지만(라벨 0건) 문서 본문(extractedText)·요약 리터럴 안에는 21건 있다.
 *
 * 대신 비싸다. 리터럴 인덱스가 없어서 전체 스캔이다 — 실측 ejkim 13초, 승훈 0.2초.
 * 그래서 searchGraphs가 라벨 검색이 빈손일 때만 이걸 부른다.
 *
 * 라벨은 두 번째 질의로 따로 붙인다. 스캔 질의 안에 OPTIONAL로 넣으면 ejkim이
 * 15초를 넘겨 통째로 실패했다. 대상 URI가 정해진 뒤의 조회는 주어 인덱스를 타서 싸다.
 */
export async function searchText(
  term: string,
  source: OntologySource,
  limit = 20,
): Promise<TextHit[]> {
  if (!term) return []

  const rows = await query(
    source,
    `SELECT DISTINCT ?s ?p (SUBSTR(STR(?o), 1, ${SNIPPET}) AS ?snip) WHERE {
       ${anyGraph('?s ?p ?o')}
       FILTER(isLiteral(?o) && CONTAINS(STR(?o), "${escapeLiteral(term)}"))
     } LIMIT ${Math.max(1, Math.floor(limit))}`,
    TEXT_TIMEOUT,
  )
  if (rows.length === 0) return []

  const labels = await labelsFor(
    [...new Set(rows.map((r) => r.s.value))],
    source,
  )

  return rows.map((r) => ({
    uri: r.s.value,
    label: labels.get(r.s.value) ?? '',
    snippet: r.snip?.value ?? '',
    predicate: r.p.value.startsWith(source.relationNamespace)
      ? r.p.value.slice(source.relationNamespace.length)
      : r.p.value,
    source: source.id,
  }))
}

/** 주어진 URI들의 표시명. 주어가 정해져 있어 인덱스를 타므로 싸다. */
async function labelsFor(
  uris: string[],
  source: OntologySource,
): Promise<Map<string, string>> {
  if (uris.length === 0) return new Map()
  const values = uris.map((u) => `<${u.replace(/[<>"{}|\\^`]/g, '')}>`).join(' ')

  const rows = await query(
    source,
    `SELECT ?s ?l WHERE {
       VALUES ?s { ${values} }
       ${anyGraph(`?s <${source.labelPredicate}> ?l`)}
     }`,
  )
  return new Map(rows.map((r) => [r.s.value, r.l.value]))
}

/**
 * 한 개체의 속성. 소스 네임스페이스 술어 중 값이 리터럴인 것들이다
 * (URI면 관계, 리터럴이면 속성 — ontology/build.ts와 같은 구분).
 *
 * 회의록 본문 같은 긴 텍스트가 여기 들어 있어서, LLM이 근거를 읽는 통로가 이 함수다.
 */
export async function nodeAttributes(
  uri: string,
  source: OntologySource,
): Promise<{ name: string; value: string }[]> {
  const safe = uri.replace(/[<>"{}|\\^`]/g, '')
  const rows = await query(
    source,
    `SELECT ?p ?v WHERE {
       ${anyGraph(`<${safe}> ?p ?v`)}
       FILTER(isLiteral(?v))
       FILTER(STRSTARTS(STR(?p), "${escapeLiteral(source.relationNamespace)}"))
     } LIMIT 50`,
  )
  return rows.map((r) => ({
    name: r.p.value.slice(source.relationNamespace.length),
    value: r.v.value,
  }))
}

export type Health = { ok: boolean; hasData: boolean; error?: string }

/**
 * 연결 확인. 실패해도 던지지 않는다 — 위키 레이어는 Fuseki 없이도 살아야 한다.
 *
 * ASK를 쓰면 안 된다. 두 가지가 어긋난다:
 * 1. ASK 응답은 {"head":{},"boolean":true}라 results.bindings가 없다.
 *    query()가 그걸 읽다 TypeError를 내고 catch가 삼켜서 늘 false가 됐다.
 * 2. `ASK { ?s ?p ?o }`는 기본 그래프만 본다. ejkim은 데이터가 전부 named graph에
 *    있어서(urn:ejkim:corpus:*) 70만 트리플이 있는데도 비어 보인다.
 *
 * 닿는 것(ok)과 데이터가 있는 것(hasData)은 다른 사실이라 따로 돌려준다.
 */
export async function fusekiHealth(source: OntologySource): Promise<Health> {
  try {
    const rows = await query(source, `SELECT ?s WHERE { ${anyGraph('?s ?p ?o')} } LIMIT 1`)
    // 상태 조회는 차단기를 무시하고 실제로 찔러 본다 — 살아났으면 여기서 풀린다.
    failedAt.delete(source.id)
    return { ok: true, hasData: rows.length > 0 }
  } catch (e) {
    failedAt.set(source.id, Date.now())
    return { ok: false, hasData: false, error: (e as Error).message }
  }
}

/**
 * 물려 있는 그래프 전부에 동시에 묻고 결과를 합친다.
 *
 * 한 소스가 죽어도 나머지 답은 돌려준다 — 어느 소스가 실패했는지는 sources에 남겨
 * 호출자(그리고 LLM)가 "못 찾음"과 "못 물어봄"을 구분할 수 있게 한다.
 * 동시 호출 비용은 사실상 없다. 셋을 순서대로 부를 이유가 없다.
 */
export async function searchGraphs(
  labels: string[],
  sources: OntologySource[] = QUERY_SOURCES,
): Promise<GraphResult> {
  const terms = labels.filter(Boolean)
  const now = Date.now()

  // 소스마다 독립적으로 2단계를 돈다. 소스끼리는 동시에 간다.
  const settled = await Promise.allSettled(
    sources.map(async (s) => {
      const left = cooling(s.id, now)
      if (left > 0) throw new Error(`최근 실패로 ${Math.ceil(left / 1000)}초간 건너뜀`)

      // 폴백은 **용어마다** 따로 판단한다. 소스 단위로 묶으면 흔한 말 하나가
      // 라벨에 걸리는 순간 나머지 용어의 리터럴 검색이 통째로 막힌다 —
      // 실제로 "글리세롤·제품·문서"를 물었을 때 "제품"이 걸려서 글리세롤을 놓쳤다.
      //
      // 라벨 검색은 싸니까 용어를 한꺼번에 병렬로 던진다.
      const byLabel = await Promise.all(terms.map((t) => searchEntities([t], s)))

      const missed = terms.filter((_, i) => byLabel[i].nodes.length === 0)

      // 리터럴 스캔은 전체 스캔이라 같은 엔드포인트에 동시에 던지면 서로 경합해
      // 모두 느려진다(실측: 병렬로 돌렸더니 10분을 넘겼다). 순차로, 개수도 막는다.
      const textHits: TextHit[] = []
      for (const t of missed.slice(0, MAX_TEXT_TERMS)) {
        textHits.push(...(await searchText(t, s)))
      }

      return {
        nodes: byLabel.flatMap((b) => b.nodes),
        edges: byLabel.flatMap((b) => b.edges),
        textHits,
        searchedText: missed.length > 0,
      }
    }),
  )

  const nodes: EntityNode[] = []
  const edges: EntityEdge[] = []
  const textHits: TextHit[] = []
  const status: SourceStatus[] = []

  const seenNode = new Set<string>()
  const seenEdge = new Set<string>()

  settled.forEach((r, i) => {
    const s = sources[i]
    if (r.status === 'fulfilled') {
      failedAt.delete(s.id)
      // 용어마다 따로 물었으니 같은 개체가 여러 번 올 수 있다.
      for (const n of r.value.nodes) {
        if (seenNode.has(n.uri)) continue
        seenNode.add(n.uri)
        nodes.push(n)
      }
      for (const e of r.value.edges) {
        const key = `${e.source} ${e.relation} ${e.target}`
        if (seenEdge.has(key)) continue
        seenEdge.add(key)
        edges.push(e)
      }
      textHits.push(...r.value.textHits)
      status.push({ id: s.id, name: s.name, ok: true, searchedText: r.value.searchedText })
    } else {
      const error = String(r.reason?.message ?? r.reason)
      // 건너뛴 것까지 실패 시각으로 새로 찍으면 차단이 영영 안 풀린다.
      if (!error.includes('건너뜀')) failedAt.set(s.id, now)
      status.push({ id: s.id, name: s.name, ok: false, error })
    }
  })

  return { nodes, edges, textHits, sources: status }
}
