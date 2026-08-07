import { requireSession } from '@/lib/auth/guard'
import { db } from '@/lib/db'
import { executeFlow } from '@/lib/flow/execute'

/** 그래프 RAG + LLM 작성이라 오래 걸린다. */
export const maxDuration = 600

/** FLOW 수동 실행. 문서 생성까지 끝나면 결과 slug를 준다. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const authed = await requireSession()
  if (!authed?.claims.ws) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const flow = await db.flowTask.findFirst({
    where: { id, workspaceId: authed.claims.ws, deletedAt: null },
  })
  if (!flow) return Response.json({ error: 'not found' }, { status: 404 })

  const result = await executeFlow(flow, 'manual')
  return Response.json(result, { status: result.status === 'done' ? 200 : 500 })
}
