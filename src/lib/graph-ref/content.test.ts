import { describe, it, expect } from 'vitest'
import { buildEntityContent, type Attr, type Neighbor } from './content'

const base = { sourceId: 'ejkim', name: '정아라', type: 'person', attrs: [], neighbors: [] }

const N = (label: string, rel: string, dir: 'in' | 'out', uri = `u:${label}`): Neighbor => ({
  uri,
  label,
  rel,
  dir,
})

describe('buildEntityContent', () => {
  it('타입 한 줄 + 출처 한 줄 (속성·관계 없음)', () => {
    const r = buildEntityContent(base)
    expect(r.content).toBe('`person`\n\n_그래프 소스: ejkim_\n')
    expect(r.summary).toBe('person')
    expect(r.outLinks).toEqual([])
    expect(r.content).not.toContain('## 속성')
    expect(r.content).not.toContain('## 관계')
  })

  it('속성만 있으면 속성 표만 나온다', () => {
    const attrs: Attr[] = [
      { key: '부서', value: '영업' },
      { key: '메일', value: 'a@b.c' },
    ]
    const r = buildEntityContent({ ...base, attrs })
    expect(r.content).toContain('## 속성\n\n| 항목 | 값 |\n|---|---|\n| 메일 | a@b.c |\n| 부서 | 영업 |')
    expect(r.content).not.toContain('## 관계')
  })

  it('속성 값의 파이프는 이스케이프한다', () => {
    const r = buildEntityContent({ ...base, attrs: [{ key: '비고', value: 'a|b|c' }] })
    expect(r.content).toContain('| 비고 | a\\|b\\|c |')
  })

  it('관계만 있으면 out/in 섹션이 dir대로 갈린다', () => {
    const r = buildEntityContent({
      ...base,
      neighbors: [N('가나다', '소속', 'out'), N('라마바', '작성자', 'in')],
    })
    const out = r.content.indexOf('## 관계')
    const inc = r.content.indexOf('## 이 문서를 가리키는 관계')
    expect(out).toBeGreaterThan(0)
    expect(inc).toBeGreaterThan(out)
    expect(r.content).toContain('### 소속\n\n- [[ejkim/가나다|가나다]]')
    expect(r.content).toContain('### 작성자\n\n- [[ejkim/라마바|라마바]]')
    expect(r.outLinks).toEqual(['ejkim/가나다', 'ejkim/라마바'])
  })

  it('같은 섹션 안에서 rel별로 묶는다', () => {
    const r = buildEntityContent({
      ...base,
      neighbors: [N('나', '소속', 'out'), N('가', '소속', 'out'), N('다', '담당', 'out')],
    })
    expect(r.content).toContain('## 관계\n\n### 담당\n\n- [[ejkim/다|다]]\n\n### 소속\n\n- [[ejkim/가|가]]\n- [[ejkim/나|나]]')
  })

  it('속성과 관계가 둘 다 있으면 속성이 먼저', () => {
    const r = buildEntityContent({
      ...base,
      attrs: [{ key: '부서', value: '영업' }],
      neighbors: [N('가', '소속', 'out')],
    })
    expect(r.content.indexOf('## 속성')).toBeLessThan(r.content.indexOf('## 관계'))
  })

  it('slug를 만들 수 없는 라벨은 평문으로 남기고 링크를 심지 않는다', () => {
    const r = buildEntityContent({ ...base, neighbors: [N('!!!', '소속', 'out'), N('가', '소속', 'out')] })
    expect(r.content).toContain('- !!!')
    expect(r.content).not.toContain('[[ejkim/|')
    expect(r.outLinks).toEqual(['ejkim/가'])
  })

  it('outLinks는 중복을 제거한다', () => {
    const r = buildEntityContent({
      ...base,
      neighbors: [N('가', '소속', 'out'), N('가', '담당', 'out'), N('가', '작성자', 'in')],
    })
    expect(r.outLinks).toEqual(['ejkim/가'])
  })

  it('ambiguousCount 2 이상이면 경고, 아니면 없음', () => {
    expect(buildEntityContent({ ...base, ambiguousCount: 3 }).content).toContain(
      '> 같은 이름의 개체가 3건 있습니다. 다른 개체일 수 있습니다.',
    )
    expect(buildEntityContent({ ...base, ambiguousCount: 1 }).content).not.toContain('동일')
    expect(buildEntityContent({ ...base, ambiguousCount: 1 }).content).not.toContain('개체가')
  })

  it('입력 순서가 섞여도 같은 결과 (결정성)', () => {
    const attrs: Attr[] = [
      { key: '부서', value: '영업' },
      { key: '메일', value: 'a@b.c' },
      { key: '직급', value: '과장' },
    ]
    const neighbors: Neighbor[] = [
      N('나', '소속', 'out'),
      N('가', '소속', 'out'),
      N('다', '담당', 'out'),
      N('라', '작성자', 'in'),
    ]
    const a = buildEntityContent({ ...base, attrs, neighbors })
    const b = buildEntityContent({
      ...base,
      attrs: [...attrs].reverse(),
      neighbors: [...neighbors].reverse(),
    })
    expect(b.content).toBe(a.content)
    expect(b.outLinks).toEqual(a.outLinks)
  })
})
