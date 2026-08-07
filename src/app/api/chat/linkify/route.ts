import { requireSession } from '@/lib/auth/guard'
import { proposeLinks, MAX_CONTENT } from '@/lib/pages/linkify'
import { sanitizeLinkedText } from '@/lib/rag/compose'

/**
 * 스트리밍으로 받은 채팅 답변을 사후 정리한다 — 지어낸 링크 강등 + 놓친 개체 링크 보강.
 * 서버 저장본(onFinish)과 같은 규칙을 화면 쪽에도 적용하기 위한 엔드포인트.
 */
export async function POST(req: Request) {
  const authed = await requireSession()
  if (!authed) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const text: unknown = body?.text
  if (typeof text !== 'string' || !text.trim()) return Response.json({ content: '', changed: false })
  if (text.length > MAX_CONTENT) return Response.json({ content: text, changed: false })

  const cleaned = await sanitizeLinkedText(text)
  const enriched = await proposeLinks('', cleaned)
  return Response.json({ content: enriched.content, changed: enriched.content !== text })
}
