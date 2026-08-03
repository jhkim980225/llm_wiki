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
  // 1) slug 배정 — 라벨이 같은 개체는 뒤에 번호를 붙여 갈라놓는다.
  const slugOf = new Map<string, string>()
  const used = new Set<string>()
  for (const e of entities) {
    let slug = entitySlug(source, e.label, e.uri)
    if (used.has(slug)) {
      let n = 2
      while (used.has(`${slug}-${n}`)) n++
      slug = `${slug}-${n}`
    }
    used.add(slug)
    slugOf.set(e.uri, slug)
  }

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
    if (!slugOf.has(t.s)) continue
    const rel = localName(t.p)

    if (t.literal) {
      take(t.s).attrs.push([rel, t.o])
      continue
    }
    // 이번 묶음 밖을 가리키는 관계는 버린다. 죽은 링크 대량 생성 방지.
    const targetSlug = slugOf.get(t.o)
    if (!targetSlug) continue

    push(take(t.s).out, rel, { slug: targetSlug, label: labelOf.get(t.o) || t.o })
    push(take(t.o).in, rel, { slug: slugOf.get(t.s)!, label: labelOf.get(t.s) || t.s })
  }

  // 3) 마크다운으로 굽는다.
  return entities.map((e) => {
    const slug = slugOf.get(e.uri)!
    const b = bucket.get(e.uri) ?? { out: new Map(), in: new Map(), attrs: [] }
    const typeNames = e.types.map(localName)
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
      title: e.label || slug,
      summary: typeNames.join(' · '),
      // 온톨로지 개체는 전부 entity로 둔다. 문서 타입은 위키 쪽 개념이다.
      pageType: 'entity',
      aliases: typeNames,
      content: lines.join('\n').trimEnd() + '\n',
      outLinks: [...new Set(outLinks)],
    }
  })
}
