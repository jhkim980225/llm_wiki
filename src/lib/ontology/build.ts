import { normalizeSlug } from '@/lib/wiki/slug'
import type { OntologySource } from './source'

export type RawEntity = { uri: string; label: string; types: string[] }
export type RawTriple = { s: string; p: string; o: string; literal: boolean }

export type BuiltPage = {
  uri: string
  slug: string
  title: string
  summary: string
  pageType: string
  aliases: string[]
  content: string
  outLinks: string[]
}

/** IRI에서 사람이 읽는 꼬리만 남긴다. `...#판매` → `판매` */
export function localName(iri: string): string {
  const cut = Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/'), iri.lastIndexOf(':'))
  return cut >= 0 ? iri.slice(cut + 1) : iri
}

/** 소스 id를 앞에 붙여 소스가 늘어도 slug가 겹치지 않게 한다. */
export function entitySlug(source: OntologySource, label: string, uri = ''): string {
  const base = normalizeSlug(label)
  if (base) return `${source.id}/${base}`
  // 라벨이 없는 개체도 주소는 있어야 한다. URI를 접어 짧은 식별자를 만든다.
  let h = 0
  for (const ch of uri) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `${source.id}/urn-${h.toString(36)}`
}

/**
 * 개체와 트리플을 위키 문서 묶음으로 바꾼다. I/O 없음.
 *
 * 관계는 `[[slug|표시명]]`으로 적어 옵시디언처럼 문서끼리 걸어둔다. 대상 개체가
 * 이번 묶음에 없으면 링크로 만들지 않는다 — 죽은 링크를 대량으로 심지 않기 위해서다.
 * 역방향 관계도 대상 문서에 적어, 어느 쪽에서 읽어도 이웃으로 넘어갈 수 있게 한다.
 */
export function buildPages(
  source: OntologySource,
  entities: RawEntity[],
  triples: RawTriple[],
): BuiltPage[] {
  // 0) 분신 병합 판정 — ejkim이 메일 1건을 여러 노드로 쪼갠다(Email=라벨만,
  //    BusinessCase=본문 보유, 서로 연결). 라벨이 같고 서로 직접 연결돼 있으며
  //    한쪽만 리터럴이 없으면, 리터럴 없는 분신을 본체 문서로 흡수한다.
  //    호스트 후보가 여럿이면 모호하므로 병합하지 않는다 — 동명 251건짜리
  //    "[성진] 발주서 송부의 건"류는 서로 미연결이라 애초에 안 걸린다.
  const hasLiteral = new Set<string>()
  const adjacent = new Map<string, Set<string>>()
  const link = (a: string, b: string) => {
    let set = adjacent.get(a)
    if (!set) adjacent.set(a, (set = new Set()))
    set.add(b)
  }
  for (const t of triples) {
    if (t.literal) hasLiteral.add(t.s)
    else {
      link(t.s, t.o)
      link(t.o, t.s)
    }
  }

  const byLabel = new Map<string, RawEntity[]>()
  for (const e of entities) {
    if (!e.label) continue
    const list = byLabel.get(e.label) ?? []
    list.push(e)
    byLabel.set(e.label, list)
  }

  const mergedInto = new Map<string, string>()
  const extraTypes = new Map<string, string[]>()
  for (const group of byLabel.values()) {
    if (group.length < 2) continue
    for (const shell of group) {
      if (hasLiteral.has(shell.uri)) continue
      const near = adjacent.get(shell.uri)
      const hosts = group.filter((h) => h !== shell && hasLiteral.has(h.uri) && near?.has(h.uri))
      if (hosts.length !== 1) continue
      mergedInto.set(shell.uri, hosts[0].uri)
      // 분신의 클래스명(Email 등)을 본체 aliases에 남겨 검색이 계속 걸리게 한다.
      extraTypes.set(hosts[0].uri, [...(extraTypes.get(hosts[0].uri) ?? []), ...shell.types])
    }
  }
  const resolve = (uri: string) => mergedInto.get(uri) ?? uri

  // 1) slug 배정 — 라벨이 같은 개체는 뒤에 번호를 붙여 갈라놓는다.
  //    Fuseki 결과 순서가 비결정적이라 uri로 정렬해 번호 배정을 결정적으로 만든다
  //    (안 하면 재적재마다 -2가 다른 개체로 옮겨 붙어 prune이 문서를 갈아치운다).
  //    병합된 분신은 slug를 소비하지 않고 본체 slug를 같이 쓴다.
  const ordered = [...entities].sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0))
  const slugOf = new Map<string, string>()
  const used = new Set<string>()
  for (const e of ordered) {
    if (mergedInto.has(e.uri)) continue
    let slug = entitySlug(source, e.label, e.uri)
    if (used.has(slug)) {
      let n = 2
      while (used.has(`${slug}-${n}`)) n++
      slug = `${slug}-${n}`
    }
    used.add(slug)
    slugOf.set(e.uri, slug)
  }
  for (const [shell, host] of mergedInto) slugOf.set(shell, slugOf.get(host)!)

  const labelOf = new Map(entities.map((e) => [e.uri, e.label]))

  // 2) 개체별로 관계(정방향·역방향)와 속성을 모은다.
  type Bucket = {
    out: Map<string, { slug: string; label: string }[]>
    in: Map<string, { slug: string; label: string }[]>
    attrs: [string, string][]
  }
  const bucket = new Map<string, Bucket>()
  const take = (uri: string): Bucket => {
    let b = bucket.get(uri)
    if (!b) {
      b = { out: new Map(), in: new Map(), attrs: [] }
      bucket.set(uri, b)
    }
    return b
  }

  const push = (m: Map<string, { slug: string; label: string }[]>, key: string, v: { slug: string; label: string }) => {
    const list = m.get(key) ?? []
    if (!list.some((x) => x.slug === v.slug)) list.push(v)
    m.set(key, list)
  }

  for (const t of triples) {
    // 병합된 분신의 트리플은 본체 것으로 다룬다.
    const s = resolve(t.s)
    if (!slugOf.has(s)) continue
    const rel = localName(t.p)

    if (t.literal) {
      take(s).attrs.push([rel, t.o])
      continue
    }
    const o = resolve(t.o)
    // 분신↔본체를 잇던 관계는 병합 후 자기 자신을 가리킨다 — 링크로 만들지 않는다.
    if (s === o) continue
    // 이번 묶음 밖을 가리키는 관계는 버린다. 죽은 링크 대량 생성 방지.
    const targetSlug = slugOf.get(o)
    if (!targetSlug) continue

    push(take(s).out, rel, { slug: targetSlug, label: labelOf.get(o) || o })
    push(take(o).in, rel, { slug: slugOf.get(s)!, label: labelOf.get(s) || s })
  }

  // 3) 마크다운으로 굽는다. 병합된 분신은 페이지를 만들지 않는다.
  return entities.filter((e) => !mergedInto.has(e.uri)).map((e) => {
    const slug = slugOf.get(e.uri)!
    const b = bucket.get(e.uri) ?? { out: new Map(), in: new Map(), attrs: [] }
    const typeNames = [...new Set([...e.types, ...(extraTypes.get(e.uri) ?? [])])].map(localName)
    const lines: string[] = []
    const outLinks: string[] = []

    if (typeNames.length > 0) {
      lines.push(typeNames.map((t) => `\`${t}\``).join(' · '), '')
    }

    if (b.attrs.length > 0) {
      lines.push('## 속성', '', '| 항목 | 값 |', '|---|---|')
      for (const [k, v] of b.attrs) lines.push(`| ${k} | ${v.replace(/\|/g, '\\|')} |`)
      lines.push('')
    }

    const section = (title: string, m: Map<string, { slug: string; label: string }[]>) => {
      if (m.size === 0) return
      lines.push(`## ${title}`, '')
      for (const [rel, targets] of m) {
        lines.push(`### ${rel}`, '')
        for (const t of targets) {
          lines.push(`- [[${t.slug}|${t.label}]]`)
          outLinks.push(t.slug)
        }
        lines.push('')
      }
    }

    section('관계', b.out)
    section('이 문서를 가리키는 관계', b.in)

    return {
      uri: e.uri,
      slug,
      // NUL(0x00)이 든 리터럴이 실재한다(ejkim 첨부 추출 본문) — Postgres text가
      // 거부해 적재가 통째로 죽으므로 여기서 걷어낸다.
      title: (e.label || slug).replace(/\u0000/g, ''),
      summary: typeNames.join(' · '),
      // 온톨로지 개체는 전부 entity로 둔다. 문서 타입은 위키 쪽 개념이다.
      pageType: 'entity',
      aliases: typeNames,
      content: (lines.join('\n').trimEnd() + '\n').replace(/\u0000/g, ''),
      outLinks: [...new Set(outLinks)],
    }
  })
}
