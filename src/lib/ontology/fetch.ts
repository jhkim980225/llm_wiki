import { escapeLiteral } from '@/lib/fuseki/client'
import type { OntologySource } from './source'
import type { RawEntity, RawTriple } from './build'

export type Binding = Record<string, { type: string; value: string }>

/**
 * 소스마다 데이터를 기본 그래프에 두기도 하고 named graph에 두기도 한다
 * (승훈=기본, ejkim·kakao=named). 어느 쪽이든 잡히도록 두 경우를 합집합으로 묶는다.
 */
const anyGraph = (pattern: string) =>
  `{ ${pattern} } UNION { GRAPH ?__g { ${pattern} } }`

/**
 * 임의 SPARQL을 소스에 던지고 바인딩을 돌려준다. 적재 외에 GraphRef(개체 조회)도 쓴다.
 * 외부(LLM)가 만든 쿼리를 넣을 때는 호출자가 먼저 `graph-ref/sparql.ts`의
 * `assertReadOnly`를 통과시켜야 한다 — 여기서는 검사하지 않는다.
 */
export async function query(source: OntologySource, sparql: string): Promise<Binding[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/sparql-query',
    Accept: 'application/sparql-results+json',
  }
  if (source.user) {
    headers.Authorization =
      'Basic ' + Buffer.from(`${source.user}:${source.password ?? ''}`).toString('base64')
  }

  const url = `${source.url.replace(/\/+$/, '')}/${source.dataset}/sparql`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: sparql,
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`${source.id}: SPARQL ${res.status}`)
  const body = (await res.json()) as { results: { bindings: Binding[] } }
  return body.results.bindings
}

/** 표시명 있는 개체 총수 — 전량 적재(prune 안전장치) 판정에 쓴다. */
export async function fetchEntityCount(source: OntologySource): Promise<number> {
  const rows = await query(
    source,
    `SELECT (COUNT(DISTINCT ?s) AS ?n) WHERE {
       ${anyGraph(`?s <${source.labelPredicate}> ?label`)}
     }`,
  )
  return Number(rows[0]?.n?.value ?? 0)
}

/** 표시명이 있는 개체와 그 클래스. 표시명 없는 노드는 문서로 만들지 않는다. */
export async function fetchEntities(source: OntologySource, limit: number): Promise<RawEntity[]> {
  const rows = await query(
    source,
    `SELECT ?s ?label (GROUP_CONCAT(DISTINCT STR(?t); separator="|") AS ?types) WHERE {
       ${anyGraph(`?s <${source.labelPredicate}> ?label . OPTIONAL { ?s a ?t }`)}
     } GROUP BY ?s ?label LIMIT ${Math.max(1, Math.floor(limit))}`,
  )
  return rows.map((r) => ({
    uri: r.s.value,
    label: r.label.value,
    types: (r.types?.value ?? '').split('|').filter(Boolean),
  }))
}

/**
 * 주어진 개체들에 걸린 트리플. 소스 네임스페이스의 술어만 가져온다 —
 * rdf:type과 rdfs:label은 이미 개체 조회에서 다뤘다.
 *
 * URI 목록을 VALUES로 밀어넣기 때문에 한 번에 보내는 양을 나눈다.
 */
export async function fetchTriples(
  source: OntologySource,
  uris: string[],
  chunkSize = 400,
): Promise<RawTriple[]> {
  const out: RawTriple[] = []

  for (let i = 0; i < uris.length; i += chunkSize) {
    const values = uris
      .slice(i, i + chunkSize)
      .map((u) => `<${u.replace(/[<>"{}|\\^`]/g, '')}>`)
      .join(' ')

    const rows = await query(
      source,
      `SELECT DISTINCT ?s ?p ?o WHERE {
         VALUES ?s { ${values} }
         ${anyGraph('?s ?p ?o')}
         FILTER(STRSTARTS(STR(?p), "${escapeLiteral(source.relationNamespace)}"))
       }`,
    )
    for (const r of rows) {
      out.push({ s: r.s.value, p: r.p.value, o: r.o.value, literal: r.o.type === 'literal' })
    }
  }
  return out
}

/**
 * 주어진 URI들의 표시명만 가져온다. 부분 적재에서 관계 대상이 슬라이스 밖에 있을 때
 * 그 대상까지 문서로 만들어 링크가 끊기지 않게 하는 용도다 (1홉 닫기).
 */
export async function fetchLabels(
  source: OntologySource,
  uris: string[],
  chunkSize = 400,
): Promise<RawEntity[]> {
  const out: RawEntity[] = []

  for (let i = 0; i < uris.length; i += chunkSize) {
    const values = uris
      .slice(i, i + chunkSize)
      .map((u) => `<${u.replace(/[<>"{}|\^`]/g, '')}>`)
      .join(' ')

    const rows = await query(
      source,
      `SELECT ?s ?label (GROUP_CONCAT(DISTINCT STR(?t); separator="|") AS ?types) WHERE {
         VALUES ?s { ${values} }
         ${anyGraph(`?s <${source.labelPredicate}> ?label . OPTIONAL { ?s a ?t }`)}
       } GROUP BY ?s ?label`,
    )
    for (const r of rows) {
      out.push({
        uri: r.s.value,
        label: r.label.value,
        types: (r.types?.value ?? '').split('|').filter(Boolean),
      })
    }
  }
  return out
}
