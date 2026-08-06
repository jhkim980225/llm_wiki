import { NextResponse } from 'next/server'

/**
 * k8s readinessProbe용 무인증 엔드포인트 (미들웨어 matcher에서 제외).
 * 인증 게이트 도입으로 /api/ontology 프로브가 401을 받아 파드가 ready가 안 되는
 * 사고가 있었다 — 프로브는 반드시 여기만 친다.
 */
export function GET() {
  return NextResponse.json({ ok: true })
}
