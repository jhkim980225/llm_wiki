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

  it('같은 이름은 한 번만', () => {
    expect(
      cleanEntities([
        { name: '정아라', type: 'person' },
        { name: '정아라', type: 'employee' },
      ]),
    ).toEqual([{ name: '정아라', type: 'person' }])
  })
})
