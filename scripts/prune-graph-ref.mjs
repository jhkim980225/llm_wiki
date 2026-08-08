/**
 * 이미 쌓인 GraphRef 중 강화된 필터(lib/graph-ref/entities.ts)를 못 통과하는 행을 지운다.
 * 필터를 고치기 전에 수집된 것들이 남아 있어서다(감사 실측: seunghoon 198건 중 다수가 비개체).
 *
 *   node scripts/prune-graph-ref.mjs            # 목록만 (기본)
 *   node scripts/prune-graph-ref.mjs --apply    # 실제 삭제
 *
 * DATABASE_URL이 가리키는 DB에 대고 돈다. 프로덕션은 포트포워딩 후 URL을 넘긴다.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const apply = process.argv.includes('--apply')

// entities.ts의 규칙을 여기로 옮겨 둔다 — 이 스크립트는 앱 밖에서 도는 일회성 도구라
// '@/' 별칭을 못 쓴다. 규칙이 바뀌면 양쪽을 같이 고친다.
const GENERIC = new Set([
  '원료', '제품', '신원료', '원료명', '제품명', '제품의', '기초제품', '원료단가',
  '반품기준', '담당자', '대표이사', '견적서', '발주서', '제품표준서', '양식', '요청',
  '확인', '개발비', '원료비', '비고', '수량', '단가', '금액', '합계', '규격', '용량',
])
const NOT_ENTITY = [
  /\.(xlsx?|xlsb|pdf|docx?|pptx?|hwp|csv|zip|png|jpe?g)$/i,
  /^\[시트[:\s]/,
  /^[○●▪·]\s*\w+\s*(name|품명)\s*[:：]/i,
  /(개발비|구매비|시험\s*검사비|진행비|제작비|택배[^)]*비|퀵비)\s*(\(|$)/,
  /^\(.*\)$/,
  /\d+\s*(ea|EA|개|kg|ml|g)(?![\w가-힣])/,
  /[\d만천]+\s*개\s*기준/,
  /^(총|약)\s/,
]
const SENTENCE_TAIL = /(습니다|합니다|입니다|됩니다|한다|이다|였다|보관|제거|수행|끼침)$/
const count = (s, ch) => s.split(ch).length - 1

function reject(name) {
  if (name.length < 2 || name.length > 60) return '길이'
  if (count(name, ')') > count(name, '(') || count(name, '”') > count(name, '“')) return '괄호 불균형'
  if (/[이라]?\s*한다/.test(name)) return '계약서 정의부'
  if (SENTENCE_TAIL.test(name)) return '문장 조각'
  if (GENERIC.has(name)) return '일반 낱말'
  const hit = NOT_ENTITY.find((re) => re.test(name))
  if (hit) return '비개체 패턴'
  if ((name.match(/,/g) ?? []).length >= 2) return '나열 조각'
  return null
}

const rows = await db.graphRef.findMany({ select: { id: true, name: true, type: true, sourceId: true } })
const doomed = rows.map((r) => ({ ...r, why: reject(r.name) })).filter((r) => r.why)

console.log(`전체 ${rows.length}건 · 제거 대상 ${doomed.length}건`)
for (const d of doomed) console.log(`  [${d.sourceId}/${d.type}] ${d.name}  — ${d.why}`)

if (!apply) {
  console.log('\n(목록만 출력했다. 실제로 지우려면 --apply)')
} else if (doomed.length > 0) {
  const { count: n } = await db.graphRef.deleteMany({ where: { id: { in: doomed.map((d) => d.id) } } })
  console.log(`\n삭제 완료: ${n}건`)
}
await db.$disconnect()
