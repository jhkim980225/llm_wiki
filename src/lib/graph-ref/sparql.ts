/**
 * 그래프 참조용 SPARQL 조립 + 신뢰 경계 검사. I/O 없는 순수 모듈이다.
 *
 * 여기 담긴 것은 두 가지다.
 *  - 우리가 만드는 질의(neighborQuery·labelLookupQuery): 값 이스케이프가 전부다.
 *  - 남이 만든 질의(assertReadOnly·enforceLimit): LLM이 뱉은 문자열을 Fuseki에
 *    던지기 전 마지막 관문. 읽기 전용인지, 한 구문인지, 상한이 걸렸는지만 본다.
 */
import { escapeLiteral } from '@/lib/fuseki/client'
import type { OntologySource } from '@/lib/ontology/source'

/**
 * 소스마다 데이터를 기본 그래프에 두기도 하고 named graph에 두기도 한다
 * (승훈=기본, ejkim·kakao=named). 어느 쪽이든 잡히도록 합집합으로 묶는다.
 *
 * 한 질의에서 여러 번 쓸 때는 그래프 변수를 **반드시 다르게** 줘야 한다. 같은 이름을
 * 쓰면 두 패턴이 같은 named graph 안에 있을 것을 요구하게 되는데, ejkim은 본문과
 * 라벨이 서로 다른 그래프에 있어서 그렇게 하면 라벨이 통째로 안 잡힌다.
 */
const anyGraph = (pattern: string, g: string) =>
  `{ ${pattern} } UNION { GRAPH ${g} { ${pattern} } }`

/** `<...>` 안에 넣어도 안전한 URI인지. 트리플 밖으로 새는 문자는 통째로 거부한다. */
function assertUri(uri: string): string {
  if (!uri) throw new Error('URI가 비었습니다')
  if (/[<>"{}|\\^`\s]/.test(uri)) throw new Error(`URI에 쓸 수 없는 문자가 있습니다: ${uri}`)
  return uri
}

/**
 * 한 URI의 1홉 이웃을 양방향으로. ?dir 은 "out"(uri가 주어) / "in"(uri가 목적어).
 * ?otherLabel 은 OPTIONAL — 라벨 없는 노드도 관계는 보여준다.
 */
export function neighborQuery(source: OntologySource, uri: string): string {
  const u = assertUri(uri)
  const out = `<${u}> ?rel ?other . BIND("out" AS ?dir)`
  const inc = `?other ?rel <${u}> . BIND("in" AS ?dir)`
  const lbl = `?other <${source.labelPredicate}> ?otherLabel`

  return `SELECT DISTINCT ?rel ?other ?otherLabel ?dir WHERE {
  { ${anyGraph(out, '?__go')} }
  UNION
  { ${anyGraph(inc, '?__gi')} }
  OPTIONAL { ${anyGraph(lbl, '?__gl')} }
} LIMIT 200`
}

/** 표시명이 정확히 일치하는 개체. 링크 후보를 URI로 되찾을 때 쓴다. */
export function labelLookupQuery(source: OntologySource, label: string): string {
  const pattern = `?s <${source.labelPredicate}> "${escapeLiteral(label)}"`
  return `SELECT DISTINCT ?s WHERE {
  ${anyGraph(pattern, '?__g')}
} ORDER BY ?s LIMIT 5`
}

/**
 * 문자열 리터럴·IRI·주석의 내용을 같은 길이의 `_`(주석은 공백)로 덮는다.
 *
 * 한 번의 스캔으로 처리하는 이유: 주석을 먼저 지우면 `#`가 든 IRI(rdf-schema#label)가
 * 잘리고, IRI를 먼저 지우면 주석 안의 따옴표(don't)가 리터럴을 열어 버린다.
 * 길이를 보존해야 원본 문자열의 위치를 그대로 쓸 수 있다(enforceLimit).
 */
function maskLiterals(q: string): string {
  const out = q.split('')
  let i = 0
  while (i < q.length) {
    const c = q[i]
    if (c === '#') {
      while (i < q.length && q[i] !== '\n') out[i++] = ' '
      continue
    }
    if (c === '<') {
      const m = /^<[^<>"{}|^`\\\s]*>/.exec(q.slice(i))
      if (m) {
        for (let k = i; k < i + m[0].length; k++) out[k] = '_'
        i += m[0].length
        continue
      }
      i++
      continue
    }
    if (c === '"' || c === "'") {
      const delim = q.startsWith(c.repeat(3), i) ? c.repeat(3) : c
      let j = i + delim.length
      while (j < q.length) {
        if (q[j] === '\\') {
          j += 2
          continue
        }
        if (q.startsWith(delim, j)) {
          j += delim.length
          break
        }
        j++
      }
      const end = Math.min(j, q.length)
      for (let k = i; k < end; k++) out[k] = '_'
      i = end
      continue
    }
    i++
  }
  return out.join('')
}

const UPDATE_WORDS = /\b(INSERT|DELETE|DROP|CLEAR|LOAD|CREATE|ADD|MOVE|COPY)\b/i

/**
 * 외부(LLM)가 만든 질의를 Fuseki에 던지기 전 검사. 읽기 전용이 아니면 던진다.
 *
 * ponytail: 파서가 아니라 거름망이다 — 애매하면 거부한다. 통과한 질의가 안전한 것이지,
 * 거부된 질의가 반드시 공격인 것은 아니다. 오탐이 문제가 되면 그때 파서를 붙인다.
 */
export function assertReadOnly(sparql: string): void {
  const masked = maskLiterals(sparql)

  if (UPDATE_WORDS.test(masked)) {
    throw new Error(`읽기 전용 질의가 아닙니다: ${UPDATE_WORDS.exec(masked)![1].toUpperCase()}`)
  }

  // 선행 PREFIX/BASE 선언을 걷어낸 뒤의 첫 키워드를 본다.
  let body = masked.trim()
  for (;;) {
    const m = /^(?:PREFIX\s+[^\s:]*:\s*\S+|BASE\s+\S+)\s*/i.exec(body)
    if (!m) break
    body = body.slice(m[0].length)
  }
  if (!/^(SELECT|CONSTRUCT|ASK|DESCRIBE)\b/i.test(body)) {
    throw new Error('SELECT·CONSTRUCT·ASK·DESCRIBE 로 시작하는 질의만 허용합니다')
  }

  // `;`는 술어-객체 목록 구분자로도 쓰이므로 중괄호 **밖**(깊이 0)의 것만 본다.
  // 뒤에 아무것도 없는 홀로 남은 세미콜론은 이어붙인 구문이 아니므로 넘어간다.
  let depth = 0
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === '{') depth++
    else if (masked[i] === '}') depth--
    else if (masked[i] === ';' && depth <= 0 && masked.slice(i + 1).trim() !== '') {
      throw new Error('세미콜론으로 이어붙인 다중 구문은 허용하지 않습니다')
    }
  }
}

/**
 * 결과 상한을 강제한다. LIMIT이 없으면 붙이고, max보다 크면 낮춘다.
 *
 * 마지막 LIMIT만 본다. 그 뒤에 `}`가 있으면 그건 서브쿼리 것이므로 최상위엔 LIMIT이
 * 없는 것으로 치고 새로 붙인다.
 */
export function enforceLimit(sparql: string, max = 200): string {
  const masked = maskLiterals(sparql)
  const re = /\bLIMIT\s+(\d+)/gi
  let last: RegExpExecArray | null = null
  for (let m = re.exec(masked); m; m = re.exec(masked)) last = m

  if (!last || masked.slice(last.index + last[0].length).includes('}')) {
    return `${sparql.replace(/\s+$/, '')} LIMIT ${max}`
  }
  if (Number(last[1]) <= max) return sparql
  return sparql.slice(0, last.index) + `LIMIT ${max}` + sparql.slice(last.index + last[0].length)
}
