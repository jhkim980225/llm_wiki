/**
 * 카카오 지식그래프 전용 RAG API — 이제 소스 공통 헬퍼(source-rag.ts)로 흡수됐다.
 * 기존 import(askKakaoRag/kakaoRagUrl)를 깨지 않으려 얇은 별칭만 남긴다.
 */
import { askSourceRag, ragUrl, type RagResult } from './source-rag'

export type KakaoRagResult = RagResult

export const kakaoRagUrl = (): string => ragUrl('kakao')

export const askKakaoRag = (question: string, timeoutMs = 120_000): Promise<KakaoRagResult> =>
  askSourceRag('kakao', question, timeoutMs)
