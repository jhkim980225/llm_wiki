import { db } from '@/lib/db'
import { embed, toVectorLiteral } from '@/lib/llm/embed'

/** 제목+요약으로 페이지 임베딩을 다시 계산해 저장한다(의미검색용). */
export async function updatePageEmbedding(id: string, title: string, summary: string): Promise<void> {
  const text = [title, summary].filter(Boolean).join('\n') || title
  const vec = toVectorLiteral(await embed(text))
  await db.$executeRaw`UPDATE "Page" SET embedding = ${vec}::vector WHERE id = ${id}`
}

/**
 * 저장 흐름을 막지 않는 베스트에포트 임베딩. 임베딩 백엔드가 죽어도 문서 저장은
 * 이미 끝났으므로 실패는 로그만 남기고 삼킨다(다음 저장이나 백필에서 다시 채운다).
 */
export async function embedPageSafe(p: { id: string; title: string; summary: string }): Promise<void> {
  try {
    await updatePageEmbedding(p.id, p.title, p.summary)
  } catch (e) {
    console.error(`embed-on-save 실패 (${p.id}): ${(e as Error).message}`)
  }
}
