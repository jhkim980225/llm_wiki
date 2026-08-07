import { normalizeSlug } from '@/lib/wiki/slug'

export type Attr = { key: string; value: string }
export type Neighbor = { uri: string; label: string; rel: string; dir: 'in' | 'out' }

export type BuiltContent = {
  content: string
  summary: string
  outLinks: string[]
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * 그래프에서 끌어온 개체 이웃 정보를 위키 문서 본문으로 굽는다. I/O 없음.
 *
 * 형식은 온톨로지 적재(`lib/ontology/build.ts`)와 같게 맞춘다 — 같은 화면에서
 * 섞여 보이므로 표·섹션·`[[slug|표시명]]` 모양이 어긋나면 안 된다.
 * 입력 순서가 흔들려도 같은 본문이 나오도록 전부 정렬해서 쓴다.
 */
export function buildEntityContent(input: {
  sourceId: string
  name: string
  type: string
  attrs: Attr[]
  neighbors: Neighbor[]
  ambiguousCount?: number
}): BuiltContent {
  const { sourceId, type, attrs, neighbors, ambiguousCount = 0 } = input
  const lines: string[] = []
  const outLinks: string[] = []

  lines.push(`\`${type}\``, '')

  // 동명 개체가 여럿이면 틀린 개체를 조용히 보여주지 않는다.
  if (ambiguousCount >= 2) {
    lines.push(`> 같은 이름의 개체가 ${ambiguousCount}건 있습니다. 다른 개체일 수 있습니다.`, '')
  }

  if (attrs.length > 0) {
    lines.push('## 속성', '', '| 항목 | 값 |', '|---|---|')
    for (const a of [...attrs].sort((x, y) => cmp(x.key, y.key) || cmp(x.value, y.value))) {
      lines.push(`| ${a.key} | ${a.value.replace(/\|/g, '\\|')} |`)
    }
    lines.push('')
  }

  const section = (title: string, dir: 'in' | 'out') => {
    const mine = neighbors.filter((n) => n.dir === dir)
    if (mine.length === 0) return
    lines.push(`## ${title}`, '')
    const rels = [...new Set(mine.map((n) => n.rel))].sort(cmp)
    for (const rel of rels) {
      lines.push(`### ${rel}`, '')
      const seen = new Set<string>()
      const group = mine
        .filter((n) => n.rel === rel)
        .sort((a, b) => cmp(a.label, b.label) || cmp(a.uri, b.uri))
      for (const n of group) {
        const base = normalizeSlug(n.label)
        // slug를 못 만드는 라벨은 링크로 심지 않는다 — 죽은 링크가 된다.
        if (!base) {
          if (seen.has(`t:${n.label}`)) continue
          seen.add(`t:${n.label}`)
          lines.push(`- ${n.label}`)
          continue
        }
        const slug = `${sourceId}/${base}`
        if (seen.has(slug)) continue
        seen.add(slug)
        lines.push(`- [[${slug}|${n.label}]]`)
        outLinks.push(slug)
      }
      lines.push('')
    }
  }

  section('관계', 'out')
  section('이 문서를 가리키는 관계', 'in')

  lines.push(`_그래프 소스: ${sourceId}_`)

  return {
    content: lines.join('\n').trimEnd() + '\n',
    summary: type,
    outLinks: [...new Set(outLinks)],
  }
}
