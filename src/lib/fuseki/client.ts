const LABEL_PREDICATE = 'http://www.w3.org/2000/01/rdf-schema#label'
const REL_NS = 'urn:weknora:rel:'
const ATTR_PREDICATE = 'urn:weknora:prop:attr'

export type EntityNode = { uri: string; label: string }
export type EntityEdge = { source: string; target: string; relation: string }

type SparqlResults = { results: { bindings: Record<string, { value: string }>[] } }

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

const config = () => ({
  url: (process.env.FUSEKI_URL ?? '').replace(/\/+$/, ''),
  dataset: process.env.FUSEKI_DATASET ?? 'ds',
  user: process.env.FUSEKI_USER ?? '',
  password: process.env.FUSEKI_PASSWORD ?? '',
})

async function sparqlQuery(q: string): Promise<SparqlResults> {
  const c = config()
  const headers: Record<string, string> = {
    'Content-Type': 'application/sparql-query',
    Accept: 'application/sparql-results+json',
  }
  if (c.user) {
    headers.Authorization =
      'Basic ' + Buffer.from(`${c.user}:${c.password}`).toString('base64')
  }

  // Fuseki의 읽기 엔드포인트는 /{dataset}/sparql 이다. /query 는 405를 준다.
  const res = await fetch(`${c.url}/${c.dataset}/sparql`, { method: 'POST', headers, body: q })
  if (!res.ok) throw new Error(`fuseki query failed: ${res.status}`)
  return (await res.json()) as SparqlResults
}

const graphPattern = (inner: string, namespace?: string) =>
  namespace ? `GRAPH <${namespace}> {\n${inner}\n}` : inner

/** 라벨에 검색어가 포함된 개체와 그 관계 엣지를 가져온다. */
export async function searchEntities(
  labels: string[],
  opts: { namespace?: string } = {},
): Promise<{ nodes: EntityNode[]; edges: EntityEdge[] }> {
  const terms = labels.filter(Boolean)
  if (terms.length === 0) return { nodes: [], edges: [] }

  const conds = terms.flatMap((t) => {
    const lit = escapeLiteral(t)
    return [`CONTAINS(?sl, "${lit}")`, `CONTAINS(?ol, "${lit}")`]
  })
  const inner =
    `?s ?p ?o .\n` +
    `?s <${LABEL_PREDICATE}> ?sl .\n` +
    `?o <${LABEL_PREDICATE}> ?ol .\n` +
    `FILTER(STRSTARTS(STR(?p), "${escapeLiteral(REL_NS)}"))\n` +
    `FILTER(${conds.join(' || ')})`

  const data = await sparqlQuery(
    `SELECT DISTINCT ?s ?sl ?p ?o ?ol WHERE {\n${graphPattern(inner, opts.namespace)}\n}`,
  )

  const nodes = new Map<string, EntityNode>()
  const edges: EntityEdge[] = []
  for (const b of data.results.bindings) {
    if (!nodes.has(b.s.value)) nodes.set(b.s.value, { uri: b.s.value, label: b.sl.value })
    if (!nodes.has(b.o.value)) nodes.set(b.o.value, { uri: b.o.value, label: b.ol.value })
    edges.push({
      source: b.s.value,
      target: b.o.value,
      relation: b.p.value.slice(REL_NS.length),
    })
  }
  return { nodes: [...nodes.values()], edges }
}

/** 한 개체의 속성 목록. LLM이 근거를 물을 때 쓴다. */
export async function nodeAttributes(uri: string): Promise<string[]> {
  const data = await sparqlQuery(
    `SELECT ?v WHERE { <${uri}> <${ATTR_PREDICATE}> ?v }`,
  )
  return data.results.bindings.map((b) => b.v.value)
}

/** 연결 확인. 실패해도 던지지 않는다 — 위키 레이어는 Fuseki 없이도 살아야 한다. */
export async function fusekiHealth(): Promise<boolean> {
  try {
    await sparqlQuery('ASK { ?s ?p ?o }')
    return true
  } catch {
    return false
  }
}
