import { requireSession } from '@/lib/auth/guard'
import { runFlow } from '@/lib/flow/run'

// 템플릿 참조 + 그래프 RAG + 작성이라 넉넉히.
export const maxDuration = 600

/**
 * 템플릿 기반 문서 작성(수동 1회 실행). FLOW 스케줄도 같은 엔진을 쓴다.
 * body: { templateSlug, instruction, targetFolderId?, targetFolderName? }
 */
export async function POST(req: Request) {
  const authed = await requireSession()
  if (!authed) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  if (typeof body?.templateSlug !== 'string' || typeof body?.instruction !== 'string') {
    return Response.json({ error: 'templateSlug와 instruction이 필요합니다' }, { status: 400 })
  }

  try {
    const result = await runFlow({
      templateSlug: body.templateSlug,
      instruction: body.instruction,
      targetFolderId: typeof body.targetFolderId === 'string' ? body.targetFolderId : null,
      targetFolderName: typeof body.targetFolderName === 'string' ? body.targetFolderName : null,
    })
    return Response.json({ ok: true, ...result })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 })
  }
}
