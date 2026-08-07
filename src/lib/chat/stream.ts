/**
 * /api/chat 텍스트 스트림 소비 헬퍼. 채팅 페이지와 문서 사이드 챗이 같이 쓴다.
 * 델타마다 onDelta(누적 텍스트)를 부르고, 끝나면 전체 텍스트와 대화 id를 준다.
 * HTTP 오류는 서버 메시지를 담아 throw한다.
 */
export async function streamChat(
  body: {
    messages: { role: 'user' | 'assistant'; content: string }[]
    conversationId?: string | null
    docSlug?: string
    ephemeral?: boolean
  },
  onDelta: (accumulated: string) => void,
): Promise<{ text: string; conversationId: string | null }> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `요청 실패 (HTTP ${res.status})`)
  }

  const conversationId = res.headers.get('X-Conversation-Id')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let acc = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    acc += decoder.decode(value, { stream: true })
    onDelta(acc)
  }
  return { text: acc, conversationId }
}
