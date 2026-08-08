import { describe, it, expect } from 'vitest'
import { cleanEntities } from './entities'

describe('cleanEntities', () => {
  it('정상 개체는 살린다', () => {
    expect(
      cleanEntities([
        { name: '정아라', type: 'person' },
        { name: '(주)성진', type: 'organization' },
        { name: '211-88-58527', type: 'businessNumber' },
      ]),
    ).toEqual([
      { name: '정아라', type: 'person' },
      { name: '(주)성진', type: 'organization' },
      { name: '211-88-58527', type: 'businessNumber' },
    ])
  })

  // 실측(seunghoon) — 계약서 원문을 자르다 만 조각들
  it('문장 조각을 버린다', () => {
    expect(
      cleanEntities([
        { name: '라 한다)과 주식회사 성진', type: 'organization' },
        { name: '하 “갑”이라 한다)와 주식회사 성진', type: 'organization' },
        { name: '주식회사 성진', type: 'organization' },
      ]),
    ).toEqual([{ name: '주식회사 성진', type: 'organization' }])
  })

  it('괄호 짝이 맞는 이름은 살린다', () => {
    expect(cleanEntities([{ name: '(주)성진by찰나', type: 'product' }])).toEqual([
      { name: '(주)성진by찰나', type: 'product' },
    ])
  })

  it('name·type 짝이 없거나 배열이 아니면 빈 결과', () => {
    expect(cleanEntities([{ name: '정아라' }, { type: 'person' }, null, '정아라'])).toEqual([])
    expect(cleanEntities('정아라')).toEqual([])
    expect(cleanEntities(undefined)).toEqual([])
  })

  it('너무 짧거나 긴 이름을 버린다', () => {
    expect(
      cleanEntities([
        { name: '값', type: 'thing' },
        { name: 'ㄱ'.repeat(61), type: 'thing' },
      ]),
    ).toEqual([])
  })

  // 프로덕션 감사 실측 — seunghoon이 엑셀·견적서를 훑다 올린 비개체들
  it('표 헤더·폼 필드·분류 낱말을 버린다', () => {
    const raw = ['원료', '제품명', '담당자', '견적서', '개발비', '반품기준'].map((name) => ({
      name,
      type: 'material',
    }))
    expect(cleanEntities(raw)).toEqual([])
  })

  it('파일명·시트명·서식 라벨을 버린다', () => {
    const raw = [
      { name: '앰플 벌크 65kg (작성중).xlsb', type: 'product' },
      { name: '(성진) COA-초이스바이오-마동크림 (DL3011).pdf', type: 'material' },
      { name: '[시트: 핸드크림]', type: 'material' },
      { name: '○Product Name : 마데카소사이드 크림', type: 'product' },
    ]
    expect(cleanEntities(raw)).toEqual([])
  })

  it('비용 항목·수량 라인·집계 문구를 버린다', () => {
    const raw = [
      { name: '화장품 제형 개발비', type: 'product' },
      { name: '원료구매비(퀵비 포함)', type: 'product' },
      { name: '라벤더바디로션 300개&핸드크림 4100개', type: 'product' },
      { name: '튜브 용기 (1만개기준)', type: 'product' },
      { name: '총 14,600,000원', type: 'product' },
    ]
    expect(cleanEntities(raw)).toEqual([])
  })

  it('서술어로 끝나는 문장 조각을 버린다', () => {
    const raw = [
      { name: '유도하는 주요 역할을 수행합니다', type: 'material' },
      { name: '저장통에 밀폐후 반제품실에 보관', type: 'material' },
      { name: '세포 프로세스에 영향을 끼침', type: 'material' },
    ]
    expect(cleanEntities(raw)).toEqual([])
  })

  it('전성분 나열이 잘려 들어온 것을 버린다', () => {
    expect(
      cleanEntities([{ name: '정제수, 포스페이트버퍼드셀라인, 프로판다이올', type: 'material' }]),
    ).toEqual([])
  })

  // kakao가 타입을 잘게 나눠 주면서 값·분류가 개체로 올라왔다(실측)
  it('값·분류 타입은 이름을 보기 전에 버린다', () => {
    const raw = [
      { name: '3,234,000원', type: 'amount' },
      { name: '2025-04-18', type: 'date' },
      { name: '40개', type: 'quantity' },
      { name: '031-522-4858', type: 'contact' },
      { name: '2024년', type: 'period' },
      { name: '충진', type: 'process' },
      { name: '용기', type: 'packaging' },
      { name: '크림', type: 'formulation' },
      { name: '세금계산서', type: 'documentType' },
    ]
    expect(cleanEntities(raw)).toEqual([])
  })

  it('kakao 실제 응답의 개체는 살린다', () => {
    const raw = [
      { name: '주식회사 성진', type: 'organization' },
      { name: '211-88-58527', type: 'businessNumber' },
      { name: '김윤서', type: 'person' },
      { name: '프리미어룩', type: 'brand' },
      { name: '연구원', type: 'jobTitle' },
      { name: '시카세럼', type: 'product' },
    ]
    expect(cleanEntities(raw)).toHaveLength(6)
  })

  it('진짜 개체는 새 필터를 통과한다', () => {
    const raw = [
      { name: '코바상사', type: 'organization' },
      { name: '정아라', type: 'person' },
      { name: '버블폼토너', type: 'product' },
      { name: '히알루론산 1% 솔루션', type: 'material' },
      { name: '(주)성진by찰나', type: 'product' },
    ]
    expect(cleanEntities(raw)).toHaveLength(5)
  })

  it('같은 이름은 한 번만', () => {
    expect(
      cleanEntities([
        { name: '정아라', type: 'person' },
        { name: '정아라', type: 'employee' },
      ]),
    ).toEqual([{ name: '정아라', type: 'person' }])
  })
})
