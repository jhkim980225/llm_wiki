/**
 * 의미검색용 임베딩 백필. embedding이 비어 있는 페이지를 골라 제목+요약을
 * embeddinggemma로 임베딩해 채운다. 재실행하면 남은 것만 이어서 한다(재개 가능).
 *
 *   node scripts/backfill-embeddings.mjs [건수]     # 기본 500, 0이면 전체
 *
 * .env의 DATABASE_URL / EMBED_URL / EMBED_MODEL을 쓴다.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const EMBED_URL = process.env.EMBED_URL || 'http://192.168.0.152:11434'
const EMBED_MODEL = process.env.EMBED_MODEL || 'embeddinggemma'
const DIM = 768
const CONCURRENCY = 6
const BATCH = 200

const target = process.argv[2] !== undefined ? Number(process.argv[2]) : 500

async function embed(text) {
  const res = await fetch(`${EMBED_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  })
  if (!res.ok) throw new Error(`embed HTTP ${res.status}`)
  const { embedding } = await res.json()
  if (!Array.isArray(embedding) || embedding.length !== DIM) {
    throw new Error(`bad dim ${embedding?.length}`)
  }
  return embedding
}

async function run() {
  const started = Date.now()
  let done = 0
  let failed = 0

  for (;;) {
    if (target > 0 && done >= target) break
    const take = target > 0 ? Math.min(BATCH, target - done) : BATCH
    // Unsupported 컬럼이라 Prisma 셀렉트 불가 → raw로 대상만 뽑는다.
    const rows = await db.$queryRaw`
      SELECT id, title, summary FROM "Page"
      WHERE "deletedAt" IS NULL AND embedding IS NULL
      LIMIT ${take}`
    if (rows.length === 0) break

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const slice = rows.slice(i, i + CONCURRENCY)
      await Promise.all(
        slice.map(async (r) => {
          try {
            const text = [r.title, r.summary].filter(Boolean).join('\n') || r.title
            const vec = await embed(text)
            const lit = `[${vec.join(',')}]`
            await db.$executeRaw`UPDATE "Page" SET embedding = ${lit}::vector WHERE id = ${r.id}`
            done++
          } catch (e) {
            failed++
            console.error(`skip ${r.id}: ${e.message}`)
          }
        }),
      )
    }
    const rate = done / ((Date.now() - started) / 1000)
    console.log(`진행 ${done}건 (실패 ${failed}) · ${rate.toFixed(1)}/s`)
  }

  const remain = await db.$queryRaw`
    SELECT count(*)::int AS n FROM "Page" WHERE "deletedAt" IS NULL AND embedding IS NULL`
  console.log(`완료: ${done}건 임베딩, 실패 ${failed}, 남은 미임베딩 ${remain[0].n}건`)
  await db.$disconnect()
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
