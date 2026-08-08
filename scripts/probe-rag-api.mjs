/**
 * 소스 RAG API 3개를 같은 질문으로 찔러 응답 형태·소요시간·개체 수집 결과를 비교한다.
 * 저쪽 팀이 API를 바꿨을 때 우리 쪽이 그대로 도는지 확인하는 용도.
 *
 *   node scripts/probe-rag-api.mjs            # 표로 출력
 *   node scripts/probe-rag-api.mjs --json     # 원시 결과 JSON
 *   node scripts/probe-rag-api.mjs --q "질문" # 질문 하나만
 *
 * 결과 해석은 docs/소스-rag-api.md 참조.
 * 개발 PC(VPN)에서도 RAG API는 붙는다 — 막히는 것은 kakao Fuseki(30301)뿐이다.
 */
const SOURCES = [
  { id: 'ejkim', name: '이메일 온톨로지', env: 'EJKIM_RAG_URL', url: 'http://192.168.0.113:30311/ejkim/api/rag/ask' },
  { id: 'kakao', name: '카카오 지식그래프', env: 'KAKAO_RAG_URL', url: 'http://192.168.0.114:30309/kakao/api/rag/ask' },
  { id: 'seunghoon', name: '승훈 온톨로지', env: 'SEUNGHOON_RAG_URL', url: 'http://192.168.0.113:30313/api/rag/ask' },
]

const DEFAULT_QUESTIONS = [
  '성진 사업자등록번호',
  '성진의 직원',
  '코바상사와 거래한 내역',
  '정아라가 담당한 업무',
  '성진에서 만드는 제품',
]

// src/lib/graph-ref/entities.ts와 같은 규칙. 앱 밖에서 도는 도구라 '@/' 별칭을 못 써
// 여기 옮겨 둔다 — 규칙이 바뀌면 양쪽을 같이 고친다.
const NOISE_TYPES = new Set([
  'amount', 'date', 'quantity', 'contact', 'period',
  'process', 'packaging', 'formulation', 'documentType',
])
const GENERIC = new Set([
  '원료', '제품', '신원료', '원료명', '제품명', '제품의', '기초제품', '원료단가',
  '반품기준', '담당자', '대표이사', '견적서', '발주서', '제품표준서', '양식', '요청',
  '확인', '개발비', '원료비', '비고', '수량', '단가', '금액', '합계', '규격', '용량',
  '제조원', '항목', '제조비', '전성분', '문안',
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

function reject(name, type) {
  if (NOISE_TYPES.has(type)) return `타입:${type}`
  if (name.length < 2 || name.length > 60) return '길이'
  if (count(name, ')') > count(name, '(') || count(name, '”') > count(name, '“')) return '괄호 불균형'
  if (/[이라]?\s*한다/.test(name)) return '계약서 문구'
  if (SENTENCE_TAIL.test(name)) return '문장 조각'
  if (GENERIC.has(name)) return '일반 낱말'
  if (NOT_ENTITY.some((re) => re.test(name))) return '비개체 패턴'
  if ((name.match(/,/g) ?? []).length >= 2) return '나열 조각'
  return null
}

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const qAt = args.indexOf('--q')
const questions = qAt >= 0 && args[qAt + 1] ? [args[qAt + 1]] : DEFAULT_QUESTIONS

const results = []
for (const q of questions) {
  for (const s of SOURCES) {
    const url = process.env[s.env] || s.url
    const t0 = Date.now()
    const rec = { question: q, source: s.id }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
        signal: AbortSignal.timeout(240_000),
      })
      rec.status = res.status
      rec.ms = Date.now() - t0
      const body = await res.json()
      rec.keys = Object.keys(body)
      rec.answer = String(body.answer ?? '')
      rec.entities = Array.isArray(body.entities) ? body.entities : []
      rec.kept = []
      rec.dropped = []
      for (const e of rec.entities) {
        const ok = typeof e?.name === 'string' && typeof e?.type === 'string'
        const why = ok ? reject(e.name.trim(), e.type.trim()) : '형식 불량'
        if (why) rec.dropped.push({ ...e, why })
        else rec.kept.push(e)
      }
    } catch (e) {
      rec.status = 0
      rec.ms = Date.now() - t0
      rec.error = e.message
    }
    results.push(rec)
    if (!asJson) {
      const head = `${rec.question} / ${rec.source}`.padEnd(34)
      if (rec.error) console.log(`${head} 실패 — ${rec.error}`)
      else
        console.log(
          `${head} ${rec.status} ${String(rec.ms).padStart(6)}ms · ` +
            `entities ${String(rec.entities.length).padStart(3)} → 유지 ${rec.kept.length} / 제거 ${rec.dropped.length}`,
        )
    }
  }
}

if (asJson) {
  console.log(JSON.stringify(results, null, 2))
  process.exit(0)
}

console.log('\n=== 소요 시간 ===')
for (const s of SOURCES) {
  const ms = results.filter((r) => r.source === s.id && !r.error).map((r) => r.ms)
  if (ms.length === 0) continue
  const avg = Math.round(ms.reduce((a, b) => a + b, 0) / ms.length)
  console.log(`${s.id.padEnd(10)} 최소 ${Math.min(...ms)}ms · 최대 ${Math.max(...ms)}ms · 평균 ${avg}ms`)
}

console.log('\n=== type 분포 ===')
for (const s of SOURCES) {
  const m = new Map()
  for (const r of results.filter((x) => x.source === s.id)) {
    for (const e of r.entities ?? []) m.set(e.type, (m.get(e.type) ?? 0) + 1)
  }
  const line = [...m].sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}(${c})`).join(' ')
  console.log(`${s.id.padEnd(10)} ${line || '(없음)'}`)
}

const byWhy = new Map()
for (const r of results) {
  for (const d of r.dropped ?? []) {
    const l = byWhy.get(d.why) ?? []
    if (l.length < 4) l.push(`${d.name}[${d.type}]`)
    byWhy.set(d.why, l)
  }
}
if (byWhy.size > 0) {
  console.log('\n=== 제거된 것 (사유별 표본) ===')
  for (const [w, l] of [...byWhy].sort()) console.log(`${w.padEnd(18)} ${l.join(' · ')}`)
}

const failed = results.filter((r) => r.error || r.status !== 200)
console.log(`\n${results.length - failed.length}/${results.length} 성공`)
if (failed.length > 0) process.exitCode = 1
