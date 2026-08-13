import { db } from '@/lib/db'
import { linkifyContent, parseOutLinks, type LinkRef } from '@/lib/wiki/links'
import { isNoiseLabel } from '@/lib/graph-ref/graph'

/**
 * 한 번에 제안할 링크 상한. 상한을 정하는 건 linkifyContent가 아니라 하류다 —
 * 적용한 본문을 저장하면 savePage → syncBacklinks가 새 링크 하나당 순차 왕복 2회를
 * 인터랙티브 트랜잭션(Prisma 기본 5초) 안에서 돈다. 200이면 도박이다.
 *
 * 50에서 100으로 올렸다: 개체명을 먼저 남기게 바꾼 뒤에도 5KB짜리 주간업무 문서에서
 * 담당자 한 명(김윤서)이 정확히 경계에 걸려 잘렸다 — 이름이 50개를 넘는 문서가 실재한다.
 * 100 × 왕복 2회면 5초 안에 넉넉하다. 더 올려야 하면 syncBacklinks를 일괄 쓰기로 바꾼다.
 */
export const MAX_CANDIDATES = 100

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
  //
  // GraphRef도 후보에 넣는다. 아직 문서가 없는 개체를 링크로 걸어 두면, 클릭했을 때
  // 문서 없음 화면이 "그래프에서 가져오기"를 띄운다. 새 링크 문법을 만들지 않는 이유가
  // 이것이다 — 죽은 링크 + 기존 화면 분기로 같은 결과가 난다.
  // UNION 결과에는 표현식 ORDER BY를 걸 수 없어(Postgres 0A000) 서브쿼리로 감싼다.
  // 정렬은 '누가 상한 안에 남느냐'만 정한다 — 링크를 거는 순서(긴 이름 먼저)는
  // linkifyContent가 스스로 다시 정렬한다.
  //
  // **개체명을 먼저 남긴다.** 예전엔 제목 긴 순으로만 잘라서, 본문이 조금만 길어도
  // 메일 제목·파일명이 50자리를 다 먹고 사람·업체 이름(3글자)이 통째로 밀려났다
  // (실측: 5KB짜리 주간업무 문서에서 김윤서·김종태·정아라·최담선 넷 다 링크 0건,
  //  같은 이름을 한 줄짜리 본문에 넣으면 넷 다 걸렸다).
  // 개체 여부는 GraphRef(대화·시딩으로 모은 개체 등록부)에 이름이 있는가로 본다.
  const rows = await db.$queryRaw<
    { slug: string; title: string; prio: number; weight: number; entity: boolean }[]
  >`
    SELECT c.slug, c.title, c.prio, c.weight, c.entity FROM (
      SELECT p.slug, p.title, 0 AS prio, COALESCE(array_length(p."inLinks", 1), 0) AS weight,
             EXISTS (SELECT 1 FROM "GraphRef" g WHERE g.name = p.title) AS entity
      FROM "Page" p
      WHERE p."deletedAt" IS NULL
        AND p.slug <> ${slug}
        AND char_length(p.title) >= ${MIN_TITLE_LENGTH}
        AND position(p.title IN ${content}) > 0
      UNION ALL
      SELECT "pageSlug" AS slug, name AS title, 1 AS prio, 0 AS weight, true AS entity
      FROM "GraphRef"
      WHERE "pageSlug" <> ${slug}
        AND char_length(name) >= ${MIN_TITLE_LENGTH}
        AND position(name IN ${content}) > 0
    ) c
    ORDER BY c.entity DESC, char_length(c.title) DESC, c.prio
    LIMIT ${MAX_CANDIDATES}`

  // 제목이 겹치면 같은 소스 것을 고르고, 그래도 하나로 안 좁혀지면 버린다.
  // 동명이인은 설계상 존재한다 — build.ts가 라벨 충돌 시 slug에 -2를 붙이고,
  // 소스가 여럿이면 "미생물" 같은 이름이 소스마다 따로 있다.
  // 어느 쪽으로 걸지 정할 근거가 없으면 안 거는 게 맞다.
  //
  // 같은 이름이 Page에도 GraphRef에도 있으면 Page가 본체다(적재본이 이미 있는 경우).
  // 이 좁히기를 먼저 해야, 승격 전 GraphRef가 동명이인처럼 보여 링크를 막지 않는다.
  //
  // 값이 제목인 적재본 문서(날짜 "2026-07-22", 수량 "1,330개", 금액 "190,000원")는
  // 후보에서 뺀다 — 본문의 날짜·금액마다 링크가 붙어 답변이 지저분해진다(실측 채팅 화면).
  // 개체 그래프에서 값 노드를 거르는 것과 같은 판정을 쓴다.
  const best = new Map<string, number>()
  for (const r of rows) best.set(r.title, Math.min(best.get(r.title) ?? 9, r.prio))
  const candidates = rows.filter((r) => r.prio === best.get(r.title) && !isNoiseLabel(r.title))

  const bySlug = new Map(candidates.map((r) => [r.slug, r.title]))
  const mine = sourceOf(slug)
  const grouped = new Map<string, string[]>()
  for (const r of candidates) grouped.set(r.title, [...(grouped.get(r.title) ?? []), r.slug])

  // 같은 이름이 여러 소스에 있는 것은 동명이인만이 아니다 — 같은 사람·업체가 이메일에도
  // 카톡에도 기록돼 있다(실측 정아라: ejkim 6,189 백링크 · kakao 5,733). 예전엔 이 경우를
  // 전부 포기해서 거래처·담당자에 링크가 하나도 안 걸렸다.
  // 우선순위: ① 같은 소스 → ② 연결이 가장 많은 문서(그 이름으로 가장 많이 참조되는 기록).
  // 1등이 2등과 같으면 고를 근거가 없으니 그대로 포기한다.
  const weightOf = new Map(candidates.map((r) => [r.slug, r.weight]))
  const richest = (slugs: string[]): string[] => {
    const sorted = [...slugs].sort(
      (a, b) => (weightOf.get(b) ?? 0) - (weightOf.get(a) ?? 0) || a.localeCompare(b),
    )
    return (weightOf.get(sorted[0]) ?? 0) > (weightOf.get(sorted[1]) ?? 0) ? [sorted[0]] : sorted
  }

  const refs: LinkRef[] = []
  for (const [matchText, slugs] of grouped) {
    let narrowed = slugs
    if (narrowed.length > 1) {
      const sameSource = narrowed.filter((s) => sourceOf(s) === mine)
      narrowed = sameSource.length > 0 ? sameSource : narrowed
    }
    if (narrowed.length > 1) narrowed = richest(narrowed)
    if (narrowed.length === 1) refs.push({ slug: narrowed[0], matchText })
  }

  const before = new Set(parseOutLinks(content))
  const result = linkifyContent(content, refs, slug)
  const added = parseOutLinks(result.content)
    .filter((s) => !before.has(s))
    .map((s) => ({ slug: s, title: bySlug.get(s) ?? s }))

  return { ...result, added }
}
