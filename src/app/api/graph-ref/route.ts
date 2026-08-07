import { z } from 'zod'
import { requireSession } from '@/lib/auth/guard'
import { SOURCES } from '@/lib/ontology/source'
import { assertReadOnly } from '@/lib/graph-ref/sparql'
import { findRefByName, findRefBySlug, upsertRef } from '@/lib/graph-ref/store'

const Body = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.string().trim().min(1).max(60),
  sourceId: z.string().trim().refine((v) => SOURCES.some((s) => s.id === v), '알 수 없는 소스입니다'),
  uri: z.string().trim().max(2000).optional(),
  sparql: z.string().trim().max(8000).optional(),
})

/**
 * 개체 참조 조회. slug로도 이름으로도 찾는다 — 문서 없음 화면은 slug만 알고,
 * 링크 제안은 이름만 안다.
 */
export async function GET(req: Request) {
  const authed = await requireSession()
  if (!authed) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const slug = url.searchParams.get('slug')?.trim()
  const name = url.searchParams.get('name')?.trim()
  if (!slug && !name) return Response.json({ error: 'slug 또는 name이 필요합니다' }, { status: 400 })

  const ref = slug ? await findRefBySlug(slug) : await findRefByName(name!)
  return Response.json({ ref })
}

/** 개체 참조 등록(upsert). 시딩 스크립트와, 나중에 소스 API 응답 수신이 쓴다. */
export async function POST(req: Request) {
  const authed = await requireSession()
  if (!authed) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'invalid body' }, { status: 400 })
  }

  // 남이 만든 질의는 저장 시점에 한 번 거른다. 실행 시점에도 다시 본다(store.loadEgo).
  if (parsed.data.sparql) {
    try {
      assertReadOnly(parsed.data.sparql)
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 })
    }
  }

  const ref = await upsertRef(parsed.data)
  return Response.json({ ref }, { status: 201 })
}
