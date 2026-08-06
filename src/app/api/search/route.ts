import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { embed, toVectorLiteral } from '@/lib/llm/embed'

const MAX_LIMIT = 50

type Hit = { slug: string; title: string; summary: string; pageType: string }
type SemHit = Hit & { score: number }

/**
 * 의미검색. 질의를 임베딩해 pgvector 코사인 거리로 가장 가까운 문서를 찾는다.
 * embedding이 채워진(백필된) 문서만 대상이다. 임베딩 백엔드가 죽으면 502.
 */
async function semantic(q: string, limit: number): Promise<SemHit[]> {
  const vec = toVectorLiteral(await embed(q))
  return db.$queryRaw<SemHit[]>`
    SELECT slug, title, summary, "pageType",
           1 - (embedding <=> ${vec}::vector) AS score
    FROM "Page"
    WHERE "deletedAt" IS NULL AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${limit}`
}

// 한국어라 부분문자열 매칭이 유일하게 맞다. tsvector는 토크나이저가 없어
// "삼성전자"가 토큰 "삼성전자의"에 안 걸리고, pg_trgm GIN은 2~3자 질의에서
// 트라이그램이 안 뽑혀 플래너가 인덱스를 못 쓴다 — 여기선 그게 제일 흔한 질의다.
//
// position()은 LIKE 패턴이 아니라서 %/_/\ 이스케이프가 아예 필요 없다.
// 대소문자는 구분한다. 한국어엔 무의미하고, lower(content)는 행마다 본문을
// 통째로 복사한다.

/** 제목·요약만. content를 안 건드려 TOAST 해제가 없다 — 97k행에서 약 40ms. */
const byHeading = (q: string, limit: number) => db.$queryRaw<Hit[]>`
  SELECT slug, title, summary, "pageType"
  FROM "Page"
  WHERE "deletedAt" IS NULL
    AND (position(${q} IN title) > 0 OR position(${q} IN summary) > 0)
  ORDER BY
    CASE
      WHEN title = ${q} THEN 0
      WHEN starts_with(title, ${q}) THEN 1
      WHEN position(${q} IN title) > 0 THEN 2
      ELSE 3
    END,
    char_length(title),
    title
  LIMIT ${limit}`

/**
 * byHeading과 같지만 사람·AI 문서를 적재본보다 먼저 준다.
 * 편집기 [[링크]] 자동완성용 — '황' 한 글자에 온톨로지 개체 수천 건이 상위를
 * 독식하면 정작 이으려는 문서(황금추출물)가 안 보인다.
 */
const byHeadingHumanFirst = (q: string, limit: number) => db.$queryRaw<Hit[]>`
  SELECT slug, title, summary, "pageType"
  FROM "Page"
  WHERE "deletedAt" IS NULL
    AND (position(${q} IN title) > 0 OR position(${q} IN summary) > 0)
  ORDER BY
    CASE WHEN "lastEditSource" <> 'ontology' THEN 0 ELSE 1 END,
    CASE
      WHEN title = ${q} THEN 0
      WHEN starts_with(title, ${q}) THEN 1
      WHEN position(${q} IN title) > 0 THEN 2
      ELSE 3
    END,
    char_length(title),
    title
  LIMIT ${limit}`

/** 본문까지. 97k행에서 약 320ms — 여기서 드는 값이 거의 전부 content 해제다. */
const byContent = (q: string, limit: number) => db.$queryRaw<Hit[]>`
  SELECT slug, title, summary, "pageType"
  FROM "Page"
  WHERE "deletedAt" IS NULL
    AND (position(${q} IN title) > 0
      OR position(${q} IN summary) > 0
      OR position(${q} IN content) > 0)
  ORDER BY
    CASE
      WHEN title = ${q} THEN 0
      WHEN starts_with(title, ${q}) THEN 1
      WHEN position(${q} IN title) > 0 THEN 2
      WHEN position(${q} IN summary) > 0 THEN 3
      ELSE 4
    END,
    char_length(title),
    title
  LIMIT ${limit}`

export async function GET(req: Request) {
  const u = new URL(req.url)
  const q = (u.searchParams.get('q') ?? '').trim()
  const limit = Math.min(Number(u.searchParams.get('limit')) || 20, MAX_LIMIT)
  if (!q) return NextResponse.json({ items: [] })

  // 의미검색 모드: ?mode=semantic. 임베딩 백엔드가 필요하다.
  if (u.searchParams.get('mode') === 'semantic') {
    try {
      return NextResponse.json({ items: await semantic(q, limit), mode: 'semantic' })
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message, mode: 'semantic' }, { status: 502 })
    }
  }

  // 랭킹상 제목·요약 매치가 언제나 본문 매치를 이긴다. 그래서 제목·요약만으로
  // limit이 차면 본문을 훑어도 결과가 똑같다 — 의미를 바꾸지 않는 순수한 절약이다.
  //
  // ponytail: 인덱스 없음. 20만 행을 넘고 3자 이상 질의가 로그로 확인되면
  // title 한 컬럼에만 pg_trgm GIN을 건다. content엔 걸지 않는다 (재적재마다 재구축).
  // ?prefer=human — 사람·AI 문서 우선, 제목·요약만 (편집기 링크 자동완성).
  // 본문 폴백을 태우면 기본 랭킹이 덮어써서 우선순위가 사라진다.
  if (u.searchParams.get('prefer') === 'human') {
    return NextResponse.json({ items: await byHeadingHumanFirst(q, limit) })
  }

  const head = await byHeading(q, limit)
  const items = head.length === limit ? head : await byContent(q, limit)

  return NextResponse.json({ items })
}
