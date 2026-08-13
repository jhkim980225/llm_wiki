/**
 * PlantUML 렌더 프록시. 브라우저의 <img>가 여기로 오면 사내 PlantUML 서버에
 * 대신 그려 달라고 한다 — 클러스터 내부 서비스라 브라우저가 직접 못 붙는다.
 * 경로는 /svg/{인코딩} 형태만 통과시킨다 (서버의 다른 경로 노출 방지).
 */
const FORMATS = new Set(['svg', 'png'])
const ENCODED_RE = /^[A-Za-z0-9\-_~]+$/

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const base = process.env.PLANTUML_URL
  if (!base) return Response.json({ error: 'PLANTUML_URL 미설정' }, { status: 503 })

  const { path } = await ctx.params
  const [format, encoded, ...rest] = path
  if (rest.length || !FORMATS.has(format) || !encoded || !ENCODED_RE.test(encoded)) {
    return Response.json({ error: 'bad path' }, { status: 400 })
  }

  const upstream = await fetch(`${base}/${format}/${encoded}`, {
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!upstream) return Response.json({ error: 'PlantUML 서버 응답 없음' }, { status: 502 })

  // 문법 오류면 PlantUML이 에러 그림을 200이 아닌 400으로 줄 수 있다 — 그림은 그대로 전달.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'image/svg+xml',
      // 같은 텍스트는 항상 같은 그림 — 브라우저가 하루 들고 있어도 된다.
      'Cache-Control': 'private, max-age=86400',
    },
  })
}
