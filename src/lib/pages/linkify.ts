import { db } from '@/lib/db'
import { linkifyContent, parseOutLinks, type LinkRef } from '@/lib/wiki/links'

/**
 * 한 번에 제안할 링크 상한. 상한을 정하는 건 linkifyContent가 아니라 하류다 —
 * 적용한 본문을 저장하면 savePage → syncBacklinks가 새 링크 하나당 순차 왕복 2회를
 * 인터랙티브 트랜잭션(Prisma 기본 5초) 안에서 돈다. 50이면 여유 있고 200이면 도박이다.
 */
export const MAX_CANDIDATES = 50

/** 2자 온톨로지 라벨("판매", "값")은 거의 모든 문서에 걸려 쓸 수 없다. */
export const MIN_TITLE_LENGTH = 3

/** 임의 텍스트가 전체 테이블 strpos를 돌리는 입구라 본문 길이를 막는다. */
export const MAX_CONTENT = 200_000

/** 온톨로지 적재가 slug 앞에 소스 id를 붙인다. 루트 문서는 소스가 없다. */
function sourceOf(slug: string): string {
  const cut = slug.indexOf('/')
  return cut < 0 ? '' : slug.slice(0, cut)
}

export type Proposal = {
  content: string
  changed: boolean
  added: { slug: string; title: string }[]
}

/**
 * 본문에 이름이 실제로 나오는 다른 문서를 찾아 첫 출현을 [[링크]]로 감싼 본문을 돌려준다.
 * 저장하지 않는다 — 호출자가 미리보기를 띄우고 사용자가 정한다.
 */
export async function proposeLinks(slug: string, content: string): Promise<Proposal> {
  // 후보 좁히기는 Postgres에 맡긴다. content는 2KB를 넘으면 TOAST로 빠져
  // 힙 자체는 작고, 24k번의 strpos는 seq scan 한 번으로 끝난다.
  //
  // aliases는 보지 않는다. ontology/build.ts가 거기에 RDF 타입명("제품", "조직")을
  // 넣어서 동의어가 아니다 — 후보로 쓰면 수천 문서가 한 단어로 걸린다.
  //
  // position()은 linkifyContent의 indexOf와 같은 대소문자 구분 정확 매칭이다.
  // SQL만 lower()로 느슨하게 하면 같은 술어가 두 군데로 갈라져 어긋나고,
  // lower(${content})는 행마다 본문을 통째로 복사한다.
  const rows = await db.$queryRaw<{ slug: string; title: string }[]>`
    SELECT slug, title
    FROM "Page"
    WHERE "deletedAt" IS NULL
      AND slug <> ${slug}
      AND char_length(title) >= ${MIN_TITLE_LENGTH}
      AND position(title IN ${content}) > 0
    ORDER BY char_length(title) DESC
    LIMIT ${MAX_CANDIDATES}`

  // 제목이 겹치면 같은 소스 것을 고르고, 그래도 하나로 안 좁혀지면 버린다.
  // 동명이인은 설계상 존재한다 — build.ts가 라벨 충돌 시 slug에 -2를 붙이고,
  // 소스가 여럿이면 "미생물" 같은 이름이 소스마다 따로 있다.
  // 어느 쪽으로 걸지 정할 근거가 없으면 안 거는 게 맞다.
  const bySlug = new Map(rows.map((r) => [r.slug, r.title]))
  const mine = sourceOf(slug)
  const grouped = new Map<string, string[]>()
  for (const r of rows) grouped.set(r.title, [...(grouped.get(r.title) ?? []), r.slug])

  const refs: LinkRef[] = []
  for (const [matchText, slugs] of grouped) {
    const narrowed = slugs.length > 1 ? slugs.filter((s) => sourceOf(s) === mine) : slugs
    if (narrowed.length === 1) refs.push({ slug: narrowed[0], matchText })
  }

  const before = new Set(parseOutLinks(content))
  const result = linkifyContent(content, refs, slug)
  const added = parseOutLinks(result.content)
    .filter((s) => !before.has(s))
    .map((s) => ({ slug: s, title: bySlug.get(s) ?? s }))

  return { ...result, added }
}
