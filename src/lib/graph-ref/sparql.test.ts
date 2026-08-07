import { describe, it, expect } from 'vitest'
import { neighborQuery, labelLookupQuery, assertReadOnly, enforceLimit } from './sparql'
import { RDFS_LABEL, type OntologySource } from '@/lib/ontology/source'

const src: OntologySource = {
  id: 'test',
  name: '테스트',
  url: 'http://example.invalid:3030',
  dataset: 'ontology',
  relationNamespace: 'urn:test:rel:',
  labelPredicate: RDFS_LABEL,
}

describe('neighborQuery', () => {
  const q = neighborQuery(src, 'urn:test:e/1')

  it('양방향 + 라벨·타입 OPTIONAL + LIMIT 400', () => {
    expect(q).toMatch(/^SELECT DISTINCT \?rel \?other \?otherLabel \?otherType \?dir WHERE \{/)
    expect(q).toContain('<urn:test:e/1> ?rel ?other')
    expect(q).toContain('?other ?rel <urn:test:e/1>')
    expect(q).toContain('BIND("out" AS ?dir)')
    expect(q).toContain('BIND("in" AS ?dir)')
    expect(q).toContain(`OPTIONAL { { ?other <${RDFS_LABEL}> ?otherLabel }`)
    expect(q).toContain('OPTIONAL { { ?other a ?otherType }')
    expect(q.trimEnd().endsWith('LIMIT 400')).toBe(true)
  })

  it('기본 그래프와 named graph 양쪽을 UNION으로 잡는다', () => {
    expect(q).toContain('UNION { GRAPH ?__go {')
    expect(q).toContain('UNION { GRAPH ?__gi {')
    expect(q).toContain('UNION { GRAPH ?__gl {')
    expect(q).toContain('UNION { GRAPH ?__gt {')
  })

  it('그래프 변수는 서로 달라야 한다 (같으면 라벨이 안 잡힌다)', () => {
    const vars = [...q.matchAll(/GRAPH (\?\S+)/g)].map((m) => m[1])
    expect(new Set(vars).size).toBe(vars.length)
  })

  it('URI에 > 가 들어오면 거부', () => {
    expect(() => neighborQuery(src, 'urn:test:e/1> . ?x ?y ?z . <a')).toThrow()
  })

  it('공백·따옴표·빈 문자열도 거부', () => {
    expect(() => neighborQuery(src, 'urn:test:e 1')).toThrow()
    expect(() => neighborQuery(src, 'urn:test:"e"')).toThrow()
    expect(() => neighborQuery(src, '')).toThrow()
  })
})

describe('labelLookupQuery', () => {
  it('정확 일치 + named graph UNION + ORDER BY ?s LIMIT 5', () => {
    const q = labelLookupQuery(src, '정아라')
    expect(q).toContain(`{ ?s <${RDFS_LABEL}> "정아라" }`)
    expect(q).toContain('UNION { GRAPH ?__g {')
    expect(q.trimEnd().endsWith('ORDER BY ?s LIMIT 5')).toBe(true)
  })

  it('리터럴을 이스케이프해 질의 밖으로 못 나가게 한다', () => {
    const q = labelLookupQuery(src, 'a" } INSERT DATA { <x> <y> "z')
    expect(q).toContain('\\"')
    expect(() => assertReadOnly(q)).not.toThrow()
  })
})

describe('assertReadOnly', () => {
  const ok = (q: string) => expect(() => assertReadOnly(q)).not.toThrow()
  const no = (q: string) => expect(() => assertReadOnly(q)).toThrow()

  it('정상 읽기 질의는 통과', () => {
    ok('SELECT ?s WHERE { ?s ?p ?o } LIMIT 10')
    ok('ASK { ?s ?p ?o }')
    ok('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }')
    ok('DESCRIBE <urn:test:e/1>')
    ok('  \n select ?s where { ?s ?p ?o }')
  })

  it('PREFIX·BASE 선언이 앞에 붙어도 통과', () => {
    ok(`PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        PREFIX t: <urn:test:rel:>
        SELECT ?s WHERE { ?s rdfs:label ?l }`)
    ok('BASE <urn:test:> SELECT ?s WHERE { ?s ?p ?o }')
  })

  it('주석은 걷어내고 본다 — # 가 든 IRI는 살려 둔다', () => {
    ok(`# 사람 이름으로 찾는다
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>  # 표준 어휘
        SELECT ?s WHERE { ?s rdfs:label "김" }`)
  })

  it('리터럴 안의 delete/drop 은 오탐하지 않는다', () => {
    ok('SELECT ?s WHERE { ?s ?p "please delete this row; DROP GRAPH" }')
    ok("SELECT ?s WHERE { ?s ?p 'insert into notes' }")
  })

  it('세미콜론이 술어-객체 목록 구분자면 통과', () => {
    ok('SELECT ?s WHERE { ?s a <urn:test:C> ; <urn:test:rel:p> ?o ; <urn:test:rel:q> ?r }')
  })

  it('DELETED_AT 같은 단어는 오탐하지 않는다', () => {
    ok('SELECT ?s WHERE { ?s <urn:test:rel:DELETED_AT> ?o }')
    ok('SELECT ?deleted WHERE { ?s ?p ?deleted }')
  })

  it('갱신 질의는 거부', () => {
    no('INSERT DATA { <urn:a> <urn:b> <urn:c> }')
    no('DELETE WHERE { ?s ?p ?o }')
    no('DROP GRAPH <urn:test:g>')
    no('CLEAR ALL')
    no('LOAD <http://evil.invalid/x> INTO GRAPH <urn:g>')
    no('CREATE GRAPH <urn:g>')
    no('ADD <urn:a> TO <urn:b>')
    no('MOVE DEFAULT TO <urn:g>')
    no('COPY DEFAULT TO <urn:g>')
  })

  it('읽기 질의 뒤에 갱신을 붙인 것도 거부', () => {
    no('SELECT ?s WHERE { ?s ?p ?o } ; DROP GRAPH <urn:test:g>')
    no('SELECT ?s WHERE { ?s ?p ?o }; INSERT DATA { <a> <b> <c> }')
  })

  it('마지막 } 뒤 세미콜론으로 이어붙인 다중 구문은 거부', () => {
    no('SELECT ?s WHERE { ?s ?p ?o } ; SELECT ?x WHERE { ?x ?y ?z }')
  })

  it('끝에 홀로 남은 세미콜론은 허용(뒤에 구문 없음)', () => {
    ok('SELECT ?s WHERE { ?s ?p ?o } ;  ')
  })

  it('주석으로 위장한 갱신 질의는 거부', () => {
    no(`# SELECT ?s WHERE { ?s ?p ?o }
        DROP ALL`)
    no('#SELECT\nINSERT DATA { <a> <b> <c> }')
  })

  it('읽기 키워드로 시작하지 않으면 거부', () => {
    no('WITH <urn:g> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }')
    no('')
    no('그냥 아무 말')
  })
})

describe('enforceLimit', () => {
  it('LIMIT 이 없으면 끝에 붙인다', () => {
    expect(enforceLimit('SELECT ?s WHERE { ?s ?p ?o }')).toBe(
      'SELECT ?s WHERE { ?s ?p ?o } LIMIT 200',
    )
    expect(enforceLimit('SELECT ?s WHERE { ?s ?p ?o }\n\n')).toBe(
      'SELECT ?s WHERE { ?s ?p ?o } LIMIT 200',
    )
  })

  it('max 를 넘으면 낮춘다', () => {
    expect(enforceLimit('SELECT ?s WHERE { ?s ?p ?o } LIMIT 5000')).toBe(
      'SELECT ?s WHERE { ?s ?p ?o } LIMIT 200',
    )
    expect(enforceLimit('SELECT ?s WHERE { ?s ?p ?o } LIMIT 50', 10)).toBe(
      'SELECT ?s WHERE { ?s ?p ?o } LIMIT 10',
    )
  })

  it('max 이하면 원본 그대로', () => {
    const q = 'SELECT ?s WHERE { ?s ?p ?o } LIMIT 10'
    expect(enforceLimit(q)).toBe(q)
    expect(enforceLimit('SELECT ?s WHERE { ?s ?p ?o } LIMIT 200')).toBe(
      'SELECT ?s WHERE { ?s ?p ?o } LIMIT 200',
    )
  })

  it('소문자 limit 도 본다', () => {
    expect(enforceLimit('select ?s where { ?s ?p ?o } limit 500')).toBe(
      'select ?s where { ?s ?p ?o } LIMIT 200',
    )
    expect(enforceLimit('select ?s where { ?s ?p ?o } limit 5')).toBe(
      'select ?s where { ?s ?p ?o } limit 5',
    )
  })

  it('서브쿼리 안의 LIMIT 은 건드리지 않는다', () => {
    const sub = 'SELECT ?s WHERE { { SELECT ?s WHERE { ?s ?p ?o } LIMIT 900 } }'
    expect(enforceLimit(sub)).toBe(`${sub} LIMIT 200`)

    const both = 'SELECT ?s WHERE { { SELECT ?s WHERE { ?s ?p ?o } LIMIT 900 } } LIMIT 800'
    expect(enforceLimit(both)).toBe(
      'SELECT ?s WHERE { { SELECT ?s WHERE { ?s ?p ?o } LIMIT 900 } } LIMIT 200',
    )
  })

  it('리터럴 안의 LIMIT 은 무시한다', () => {
    const q = 'SELECT ?s WHERE { ?s ?p "LIMIT 9999" }'
    expect(enforceLimit(q)).toBe(`${q} LIMIT 200`)
  })

  it('우리가 만든 질의는 이미 상한이 걸려 있다', () => {
    // neighborQuery는 타입 OPTIONAL로 행이 불어 400을 쓴다 — 같은 상한이면 무변형.
    const q = neighborQuery(src, 'urn:test:e/1')
    expect(enforceLimit(q, 400)).toBe(q)
  })
})
