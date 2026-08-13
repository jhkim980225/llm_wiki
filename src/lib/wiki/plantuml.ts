import { encode } from 'plantuml-encoder'

/**
 * ```plantuml 펜스를 <img>로 바꾼다. 마크다운 파싱 **전에** 돌린다 —
 * marked는 블록 HTML을 그대로 통과시키므로 여기서 만든 태그가 살아남는다.
 * 그림은 PlantUML 서버가 그린다. 브라우저가 클러스터 내부 서비스에 직접 못
 * 붙으므로 앱의 프록시(/api/plantuml)를 거친다.
 *
 * src는 basePath(/graphwiki)를 직접 붙인다 — BasePathFetch는 fetch만 패치하고
 * dangerouslySetInnerHTML로 꽂히는 <img>는 Next가 접두사를 안 붙여 준다.
 */
const FENCE_RE = /```plantuml[ \t]*\r?\n([\s\S]*?)```/g

/**
 * 간트 공통 서식. 문서마다 베끼게 두면 LLM이 생성할 때마다 흔들리므로
 * 여기서 한 번 얹는다. 글꼴·굵기만 잡고 색은 문서가 정하게 둔다 —
 * 작업 색은 파트 구분이라 내용에 딸린 값이다.
 */
const GANTT_STYLE = `<style>
ganttDiagram {
  task { FontName sans-serif
    FontSize 13
    LineThickness 1.0 }
  separator { FontSize 14
    FontStyle bold
    FontColor #2C3E5A
    LineColor #C8D2E4 }
  milestone { FontSize 13
    FontStyle bold
    FontColor #6B5433 }
  closed { BackgroundColor #F4F5F8 }
  timeline { FontSize 12 }
}
</style>`

/** 이미 서식을 직접 쓴 다이어그램은 건드리지 않는다 — 저자 의도가 이긴다. */
function withHouseStyle(text: string): string {
  if (!text.startsWith('@startgantt') || text.includes('<style>')) return text
  return text.replace(/^@startgantt[^\n]*\n/, (head) => head + GANTT_STYLE + '\n')
}

export function plantumlToHtml(content: string): string {
  return content.replace(FENCE_RE, (_whole, body: string) => {
    const text = body.trim()
    if (!text) return ''
    const encoded = encode(withHouseStyle(text))
    return `\n\n<img class="plantuml" src="/graphwiki/api/plantuml/svg/${encoded}" alt="PlantUML 다이어그램" />\n\n`
  })
}
