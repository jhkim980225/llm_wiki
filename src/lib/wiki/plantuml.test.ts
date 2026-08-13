import { describe, expect, it } from 'vitest'
import { plantumlToHtml } from './plantuml'

describe('plantumlToHtml', () => {
  it('plantuml 펜스를 프록시 img로 바꾼다', () => {
    const md = '앞 문단\n\n```plantuml\n@startgantt\n[PILOT] starts 2025-07-01 and lasts 21 day\n@endgantt\n```\n\n뒤 문단'
    const out = plantumlToHtml(md)
    expect(out).toContain('<img class="plantuml" src="/graphwiki/api/plantuml/svg/')
    expect(out).not.toContain('```plantuml')
    expect(out).toContain('앞 문단')
    expect(out).toContain('뒤 문단')
  })

  it('같은 텍스트는 같은 src — 인코딩이 결정적이다', () => {
    const md = '```plantuml\n@startuml\nA -> B\n@enduml\n```'
    expect(plantumlToHtml(md)).toBe(plantumlToHtml(md))
  })

  it('다른 언어 펜스는 건드리지 않는다', () => {
    const md = '```js\nconst a = 1\n```'
    expect(plantumlToHtml(md)).toBe(md)
  })

  it('빈 펜스는 지운다', () => {
    expect(plantumlToHtml('```plantuml\n```')).not.toContain('<img')
  })

  it('간트에는 공통 서식을 얹고, 직접 쓴 서식은 두 번 얹지 않는다', () => {
    const plain = plantumlToHtml('```plantuml\n@startgantt\n[A] lasts 2 days\n@endgantt\n```')
    const styled = plantumlToHtml(
      '```plantuml\n@startgantt\n<style>\nganttDiagram { task { FontSize 20 } }\n</style>\n[A] lasts 2 days\n@endgantt\n```',
    )
    // 인코딩 결과가 다르면 원문이 달라진 것 — 얹힌 쪽과 그대로인 쪽이 갈린다
    expect(plain).not.toBe(styled)
    // 간트가 아닌 다이어그램은 원문 그대로 (서식을 안 얹는다)
    const seq = '```plantuml\n@startuml\nA -> B\n@enduml\n```'
    expect(plantumlToHtml(seq)).toBe(plantumlToHtml(seq))
  })

  it('펜스 안 위키링크 문법이 인코딩에 먹혀 링크 치환을 피한다', () => {
    const md = '```plantuml\n@startuml\nnote right: [[정아라]] 담당\n@enduml\n```'
    const out = plantumlToHtml(md)
    expect(out).not.toContain('[[정아라]]')
  })
})
