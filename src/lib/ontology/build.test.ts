import { describe, it, expect } from 'vitest'
import { buildPages, entitySlug, type RawEntity, type RawTriple } from './build'

const src = {
  id: 'sh',
  name: '승훈',
  url: 'http://x',
  dataset: 'ontology',
  relationNamespace: 'http://seunghoon-ontology/schema#',
  labelPredicate: 'http://www.w3.org/2000/01/rdf-schema#label',
}

const entities: RawEntity[] = [
  { uri: 'urn:a', label: '주식회사 성진', types: ['http://seunghoon-ontology/schema#거래처'] },
  { uri: 'urn:b', label: '아로마오일-A', types: ['http://seunghoon-ontology/schema#제품'] },
  { uri: 'urn:c', label: '호호바씨오일', types: [] },
]

const triples: RawTriple[] = [
  { s: 'urn:a', p: 'http://seunghoon-ontology/schema#판매', o: 'urn:b', literal: false },
  { s: 'urn:b', p: 'http://seunghoon-ontology/schema#함유원료', o: 'urn:c', literal: false },
  { s: 'urn:b', p: 'http://seunghoon-ontology/schema#거래일자', o: '2026-03-11', literal: true },
  { s: 'urn:b', p: 'http://seunghoon-ontology/schema#비고', o: '샘플 출고', literal: true },
]

describe('entitySlug', () => {
  it('소스 id를 앞에 붙인다', () => {
    expect(entitySlug(src, '주식회사 성진')).toBe('sh/주식회사-성진')
  })

  it('라벨이 비면 URI 해시로 대체한다', () => {
    expect(entitySlug(src, '', 'urn:zz')).toMatch(/^sh\/urn-[0-9a-z]+$/)
  })
})

describe('buildPages', () => {
  const pages = buildPages(src, entities, triples)
  const byUri = new Map(pages.map((p) => [p.uri, p]))

  it('개체마다 문서를 하나씩 만든다', () => {
    expect(pages).toHaveLength(3)
  })

  it('관계를 [[링크]]로 적는다', () => {
    expect(byUri.get('urn:a')!.content).toContain('[[sh/아로마오일-a|아로마오일-A]]')
  })

  it('관계명을 소제목으로 묶는다', () => {
    const b = byUri.get('urn:b')!.content
    expect(b).toContain('### 함유원료')
    expect(b).toContain('[[sh/호호바씨오일|호호바씨오일]]')
  })

  it('리터럴은 속성 표로 간다', () => {
    const b = byUri.get('urn:b')!.content
    expect(b).toContain('| 거래일자 | 2026-03-11 |')
    expect(b).toContain('| 비고 | 샘플 출고 |')
    expect(b).not.toContain('[[2026-03-11')
  })

  it('역방향 관계도 문서에 적어 양쪽에서 오갈 수 있다', () => {
    expect(byUri.get('urn:b')!.content).toContain('[[sh/주식회사-성진|주식회사 성진]]')
  })

  it('rdf:type을 요약과 별칭에 남긴다', () => {
    const a = byUri.get('urn:a')!
    expect(a.summary).toContain('거래처')
    expect(a.pageType).toBe('entity')
  })

  it('아웃링크가 실제 slug 목록과 맞는다', () => {
    expect(byUri.get('urn:a')!.outLinks).toEqual(['sh/아로마오일-a'])
  })

  it('대상이 없는 관계는 링크로 만들지 않는다', () => {
    const orphan = buildPages(src, [entities[0]], [
      { s: 'urn:a', p: 'http://seunghoon-ontology/schema#판매', o: 'urn:없음', literal: false },
    ])
    expect(orphan[0].outLinks).toEqual([])
  })

  it('slug가 충돌하면 뒤에 번호를 붙여 갈라놓는다', () => {
    const dup = buildPages(
      src,
      [
        { uri: 'urn:1', label: '같은이름', types: [] },
        { uri: 'urn:2', label: '같은이름', types: [] },
      ],
      [],
    )
    expect(new Set(dup.map((p) => p.slug)).size).toBe(2)
  })
})

describe('buildPages — 분신 병합', () => {
  // ejkim 패턴: Email 노드(리터럴 없음) + 동명 BusinessCase(리터럴 보유), evidenceEmail로 연결
  const shell: RawEntity = { uri: 'urn:mail', label: '발주 요청의 건', types: ['urn:ejkim:ontology:Email'] }
  const host: RawEntity = { uri: 'urn:case', label: '발주 요청의 건', types: ['urn:ejkim:ontology:BusinessCase'] }
  const third: RawEntity = { uri: 'urn:p', label: '거래처', types: [] }
  const T = (s: string, p: string, o: string, literal = false): RawTriple => ({ s, p, o, literal })

  it('동명·연결·한쪽만 리터럴이면 본체 문서 하나로 흡수한다', () => {
    const pages = buildPages(src, [shell, host, third], [
      T('urn:case', 'urn:ejkim:ontology:evidenceEmail', 'urn:mail'),
      T('urn:case', 'urn:ejkim:ontology:caseType', '발주', true),
      T('urn:p', 'urn:ejkim:ontology:sentTo', 'urn:mail'), // 제3노드 → 분신
    ])
    expect(pages).toHaveLength(2) // 본체 + 거래처
    const merged = pages.find((p) => p.uri === 'urn:case')!
    expect(pages.some((p) => p.uri === 'urn:mail')).toBe(false)
    expect(merged.content).toContain('| caseType | 발주 |')
    // 분신을 가리키던 제3노드 링크가 본체 slug로 온다
    const p3 = pages.find((p) => p.uri === 'urn:p')!
    expect(p3.outLinks).toEqual([merged.slug])
    // 분신↔본체 연결이 자기 링크로 남지 않는다
    expect(merged.outLinks).not.toContain(merged.slug)
    // 분신의 클래스명이 본체 별칭에 남는다
    expect(merged.aliases).toContain('Email')
  })

  it('동명이라도 연결이 없으면 병합하지 않는다', () => {
    const pages = buildPages(src, [shell, host], [
      T('urn:case', 'urn:ejkim:ontology:caseType', '발주', true),
    ])
    expect(pages).toHaveLength(2)
  })

  it('동명·연결이라도 양쪽 다 리터럴이 있으면 병합하지 않는다', () => {
    const pages = buildPages(src, [shell, host], [
      T('urn:case', 'urn:ejkim:ontology:evidenceEmail', 'urn:mail'),
      T('urn:case', 'urn:ejkim:ontology:caseType', '발주', true),
      T('urn:mail', 'urn:ejkim:ontology:subject', '제목', true),
    ])
    expect(pages).toHaveLength(2)
  })

  it('분신 여럿이 한 본체로 다 흡수된다', () => {
    const shell2: RawEntity = { uri: 'urn:mail2', label: '발주 요청의 건', types: [] }
    const pages = buildPages(src, [shell, shell2, host], [
      T('urn:case', 'urn:ejkim:ontology:evidenceEmail', 'urn:mail'),
      T('urn:case', 'urn:ejkim:ontology:evidenceEmail', 'urn:mail2'),
      T('urn:case', 'urn:ejkim:ontology:caseType', '발주', true),
    ])
    expect(pages).toHaveLength(1)
  })

  it('리터럴의 NUL 바이트를 걷어낸다 — Postgres가 저장을 거부한다', () => {
    const pages = buildPages(src, [host], [
      T('urn:case', 'urn:ejkim:ontology:extractedText', '본문\u0000깨진\u0000바이트', true),
    ])
    expect(pages[0].content).not.toContain('\u0000')
    expect(pages[0].content).toContain('본문깨진바이트')
  })

  it('동명 본체 후보가 둘이면 모호해서 병합하지 않는다', () => {
    const host2: RawEntity = { uri: 'urn:case2', label: '발주 요청의 건', types: [] }
    const pages = buildPages(src, [shell, host, host2], [
      T('urn:case', 'urn:ejkim:ontology:evidenceEmail', 'urn:mail'),
      T('urn:case2', 'urn:ejkim:ontology:evidenceEmail', 'urn:mail'),
      T('urn:case', 'urn:ejkim:ontology:caseType', '발주', true),
      T('urn:case2', 'urn:ejkim:ontology:caseType', '견적', true),
    ])
    expect(pages).toHaveLength(3)
  })
})
