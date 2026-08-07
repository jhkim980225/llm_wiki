/**
 * 소스 RAG API가 주는 entities를 GraphRef에 넣기 전에 거른다. I/O 없는 순수 모듈.
 *
 * 저쪽 추출이 문서 원문을 자르다 만 조각을 섞어 보낸다(실측, seunghoon):
 *   "라 한다)과 주식회사 성진", "하 “갑”이라 한다)와 주식회사 성진"
 * 이런 게 GraphRef가 되면 링크 제안이 본문 아무 데나 걸린다 — 입구에서 버린다.
 */
import { normalizeSlug } from '@/lib/wiki/slug'

export type RawEntity = { name?: unknown; type?: unknown }
export type CleanEntity = { name: string; type: string }

const MAX_NAME = 60

/** 응답의 entities 필드가 어떤 모양으로 오든 짝이 갖춰진 것만 살린다. */
export function cleanEntities(raw: unknown): CleanEntity[] {
  if (!Array.isArray(raw)) return []
  const out: CleanEntity[] = []
  const seen = new Set<string>()

  for (const item of raw as RawEntity[]) {
    if (!item || typeof item !== 'object') continue
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const type = typeof item.type === 'string' ? item.type.trim() : ''
    if (!name || !type) continue
    if (name.length < 2 || name.length > MAX_NAME) continue
    // 문장을 자르다 만 조각 — 닫는 괄호·따옴표가 여는 쪽보다 많으면 개체명이 아니다.
    if (count(name, ')') > count(name, '(') || count(name, '”') > count(name, '“')) continue
    // "…라 한다" 는 계약서 정의부 문구다. 개체명에 들어올 일이 없다.
    if (/[이라]?\s*한다/.test(name)) continue
    // slug가 안 만들어지는 이름은 문서 주소를 못 가진다.
    if (!normalizeSlug(name)) continue

    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, type })
  }
  return out
}

const count = (s: string, ch: string) => s.split(ch).length - 1
