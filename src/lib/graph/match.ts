import type { EntityNode } from '@/lib/fuseki/client'

/** 두 레이어의 이름을 비교 가능한 형태로 맞춘다. 트림·소문자·연속공백 단일화. */
export function normalizeLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * 페이지의 title 또는 alias가 Fuseki 노드 라벨과 **완전히** 같을 때만 잇는다.
 * ponytail: 부분일치·임베딩 유사도는 오탐이 그래프를 못 쓰게 만들어서 뺐다.
 * 매칭 품질이 부족하면 여기만 바꾸면 된다.
 */
export function matchLayers(
  pages: { slug: string; title: string; aliases: string[] }[],
  entities: EntityNode[],
): { pageSlug: string; entityUri: string }[] {
  const byName = new Map<string, string>()
  for (const p of pages) {
    for (const name of [p.title, ...p.aliases]) {
      const key = normalizeLabel(name)
      if (key && !byName.has(key)) byName.set(key, p.slug)
    }
  }

  const out: { pageSlug: string; entityUri: string }[] = []
  for (const e of entities) {
    const slug = byName.get(normalizeLabel(e.label))
    if (slug) out.push({ pageSlug: slug, entityUri: e.uri })
  }
  return out
}
