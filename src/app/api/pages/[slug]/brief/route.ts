import { generateText } from 'ai'
import { requireSession } from '@/lib/auth/guard'
import { db } from '@/lib/db'
import { llmConfig, llmModel, llmProviderOptions } from '@/lib/llm/provider'
import { BRIEF_SYSTEM, briefHash, briefInput, cleanBrief, needsBrief } from '@/lib/pages/brief'

/** LLM 한 번. 스트리밍이 아니라 짧게 끝난다. */
export const maxDuration = 120

/**
 * 열람 시점 요약. 있으면 그대로 주고, 없거나 본문이 바뀌었으면 만들어 저장한다.
 *
 * 같은 문서를 여러 탭에서 동시에 열면 LLM을 여러 번 부르게 된다 — 파드가 하나라
 * 진행 중인 slug를 메모리에 들고 있다가 뒤에 온 요청은 기다리지 않고 캐시 없음으로 돌려준다.
 * (화면이 재시도한다. 대기열을 만들 만큼 비싼 문제가 아니다)
 */
const inFlight = new Set<string>()

export async function POST(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const authed = await requireSession()
  if (!authed) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { slug: raw } = await params
  const slug = decodeURIComponent(raw)

  const page = await db.page.findFirst({
    where: { slug, deletedAt: null },
    select: { id: true, title: true, content: true, brief: true, briefHash: true, lastEditSource: true },
  })
  if (!page) return Response.json({ error: 'not found' }, { status: 404 })

  // 적재본만 대상 — 사람이 쓴 문서는 스스로 요약을 쓴다.
  if (page.lastEditSource !== 'ontology') {
    return Response.json({ brief: page.brief ?? null, skipped: true })
  }
  if (!needsBrief(page)) return Response.json({ brief: page.brief, cached: true })

  if (inFlight.has(slug)) return Response.json({ brief: null, pending: true })
  inFlight.add(slug)
  try {
    const config = llmConfig()
    const { text } = await generateText({
      model: llmModel(config),
      providerOptions: llmProviderOptions(config),
      system: BRIEF_SYSTEM,
      prompt: briefInput(page.title, page.content),
    })
    const brief = cleanBrief(text)
    if (!brief) return Response.json({ brief: null, error: 'empty' }, { status: 502 })

    // 요약은 가시 필드가 아니다 — version을 올리지 않고 updatedAt도 건드리지 않는다.
    // (updatedAt은 @updatedAt이라 update가 갱신하므로 raw로 쓴다)
    await db.$executeRaw`
      UPDATE "Page" SET "brief" = ${brief}, "briefHash" = ${briefHash(page.content)}
      WHERE id = ${page.id}`
    return Response.json({ brief, created: true })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 })
  } finally {
    inFlight.delete(slug)
  }
}
