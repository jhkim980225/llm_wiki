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

/**
 * 개체가 아니라 **값**이거나 **분류 낱말**인 타입 — 문서로 만들 것이 없다.
 * kakao가 타입을 잘게 나눠 주면서 드러났다(실측 표본):
 *   amount "3,234,000원" · date "2025-04-18" · quantity "40개" · contact "031-522-4858"
 *   period "2024년" · process "충진" · packaging "용기" · formulation "크림"
 *   documentType "세금계산서" — 문서 종류지 특정 문서가 아니다
 * 이름 패턴으로 거르는 것보다 정확하고 싸다.
 */
const NOISE_TYPES = new Set([
  'amount',
  'date',
  'quantity',
  'contact',
  'period',
  'process',
  'packaging',
  'formulation',
  'documentType',
])

/**
 * 개체가 아니라 문서 안 구조물인 것들 — 표 헤더·폼 필드·분류 낱말.
 * 소스가 엑셀/견적서를 훑다 보니 이런 게 개체로 올라온다(감사 실측, seunghoon).
 */
const GENERIC = new Set([
  '원료', '제품', '신원료', '원료명', '제품의', '기초제품', '원료단가',
  '반품기준', '담당자', '대표이사', '견적서', '발주서', '제품표준서', '양식', '요청',
  '확인', '개발비', '원료비', '비고', '수량', '단가', '금액', '합계', '규격', '용량',
  // kakao 실측 — 표 헤더가 ingredient/material 타입으로 올라온다
  '제조원', '항목', '제품명', '제조비', '전성분', '문안',
])

/** 비용·수량·파일·시트처럼 개체가 아닌 라인임을 드러내는 흔적. */
const NOT_ENTITY = [
  /\.(xlsx?|xlsb|pdf|docx?|pptx?|hwp|csv|zip|png|jpe?g)$/i, // 파일명
  /^\[시트[:\s]/, // 엑셀 시트명
  /^[○●▪·]\s*\w+\s*(name|품명)\s*[:：]/i, // "○Product Name :" 서식 라벨
  /(개발비|구매비|시험\s*검사비|진행비|제작비|택배[^)]*비|퀵비)\s*(\(|$)/, // 비용 항목
  /^\(.*\)$/, // 통째 괄호 — 견적 단서 조각
  // 수량 라인. \b는 한글 뒤에서 경계로 잡히지 않아(실측 "300개&…") 부정 전방탐색을 쓴다.
  /\d+\s*(ea|EA|개|kg|ml|g)(?![\w가-힣])/,
  /[\d만천]+\s*개\s*기준/, // "(1만개기준)"
  /^(총|약)\s/, // 집계 문구
]

/** 문장 조각 판정 — 개체명은 서술어로 끝나지 않는다. */
const SENTENCE_TAIL = /(습니다|합니다|입니다|됩니다|한다|이다|였다|보관|제거|수행|끼침)$/

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
    // 값·분류 타입은 이름을 보기 전에 버린다.
    if (NOISE_TYPES.has(type)) continue
    if (name.length < 2 || name.length > MAX_NAME) continue
    // 문장을 자르다 만 조각 — 닫는 괄호·따옴표가 여는 쪽보다 많으면 개체명이 아니다.
    if (count(name, ')') > count(name, '(') || count(name, '”') > count(name, '“')) continue
    // "…라 한다" 는 계약서 정의부 문구다. 개체명에 들어올 일이 없다.
    if (/[이라]?\s*한다/.test(name)) continue
    // 서술어로 끝나면 본문 문장이 잘려 들어온 것이다.
    if (SENTENCE_TAIL.test(name)) continue
    // 표 헤더·폼 필드·분류 낱말 — 개체가 아니라 문서 구조물이다.
    if (GENERIC.has(name)) continue
    // 파일명·시트명·비용 항목·수량 라인.
    if (NOT_ENTITY.some((re) => re.test(name))) continue
    // 쉼표로 나열된 전성분 목록이 잘려 들어온 것.
    if ((name.match(/,/g) ?? []).length >= 2) continue
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
