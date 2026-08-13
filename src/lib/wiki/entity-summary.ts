/**
 * 개체 문서 맨 위에 얹을 핵심 관계 요약.
 *
 * 적재기가 관계를 전부 나열하므로(값 노드 포함) 메일 한 건이 링크 100여 개를 달고
 * 나온다 — 문서를 열면 무엇이 중요한지 안 보인다. 여기서 값 노드를 걷어내고
 * 관계당 몇 개만 남겨 위에 올린다. 본문은 그대로 둔다(원본이 잘리면 안 된다).
 *
 * I/O 없는 순수 모듈. 저장된 본문을 파싱만 하므로 재적재가 필요 없다.
 */
import { isNoiseLabel } from './noise'

export type SummaryLink = { slug: string; label: string }
export type SummaryGroup = { rel: string; dir: 'out' | 'in'; links: SummaryLink[]; total: number }

type Draft = SummaryGroup & { seen: number; values: number }

/** 관계당 보여 줄 링크 수. 넘으면 '외 N개'로 접는다. */
const PER_REL = 4
/** 카드 전체 관계 수 상한 — 이걸 넘기면 요약이 아니라 목록이 된다. */
const MAX_GROUPS = 8

/**
 * 표시명에 대괄호가 들어간다 — 메일 제목이 "[럽앤다이브] 아로마 롤온…" 꼴이다.
 * 표시명을 `[^\]]+`로 잡으면 첫 `]`에서 끊겨 그 줄을 통째로 놓친다(실측).
 * slug에는 `]`·`|`가 없으므로 앞은 좁게, 표시명은 줄 끝의 `]]`까지 넓게 잡는다.
 */
const LINK_RE = /^- \[\[([^\]|]+)\|(.+)\]\]\s*$/

/**
 * 이름이 아니라 값·문장인가.
 * - 숫자 비율(isNoiseLabel): "02-2092-3721", "1.68"
 * - 적재기가 값 노드에 붙이는 `값 · 종류` 라벨 관례: "30 mL · 용량", "2026-06-29 · 업무 일정"
 *   (숫자가 절반이 안 돼 위 판정만으로는 안 걸린다)
 * - **너무 긴 것**: kakao는 업무일지 한 줄을 통째로 개체 라벨로 만든다
 *   ("2025-06-30 18:28 김윤서: 6/30(월) 업무일지 보내드립니다. 1. 엘랑드벨라 - 108ea*3box…").
 *   개체 이름은 짧다 — 긴 메일 제목("[럽앤다이브] 아로마 롤온 10ml 단상자, 라벨 문안 검수 요청의 건",
 *   44자)은 남기고 문장 덤프만 걸리게 60자로 끊는다.
 */
const MAX_NAME = 60
const isValue = (label: string) =>
  isNoiseLabel(label) || / · /.test(label) || label.length > MAX_NAME

/**
 * 관계 이름 우선순위. 낮을수록 위. 사람·조직·사건처럼 "누가 무엇을"에 답하는
 * 관계를 먼저 보여 준다. 목록에 없는 관계는 중간값을 받는다.
 */
const RANK: Record<string, number> = {
  authoredBy: 0,
  sentFromAccount: 1,
  sentToAccount: 2,
  belongsToCase: 3,
  partOfThread: 4,
  hasAttachment: 5,
  affiliatedWith: 5,
  hasJobTitle: 6,
  usesAccount: 6,
  recordsActivity: 7,
  mentionsItem: 8,
  hasEmailType: 20,
  hasBusinessFact: 30,
}
const DEFAULT_RANK = 10

/**
 * 본문의 `## 관계` / `## 이 문서를 가리키는 관계` 절을 읽어 요약 그룹을 만든다.
 * 값 노드(`30 mL`, `02-2092-3721`)는 뺀다 — 그래프·자동 링크와 같은 판정을 쓴다.
 */
export function summarizeEntity(content: string): SummaryGroup[] {
  const groups: Draft[] = []
  let dir: 'out' | 'in' | null = null
  let cur: Draft | null = null

  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      const t = line.slice(3).trim()
      dir = t === '관계' ? 'out' : t === '이 문서를 가리키는 관계' ? 'in' : null
      cur = null
      continue
    }
    if (!dir) continue
    if (line.startsWith('### ')) {
      cur = { rel: line.slice(4).trim(), dir, links: [], total: 0, seen: 0, values: 0 }
      groups.push(cur)
      continue
    }
    const m = cur && LINK_RE.exec(line)
    if (!m || !cur) continue
    const label = m[2].trim()
    cur.seen++
    if (isValue(label)) {
      cur.values++
      continue
    }
    cur.total++
    if (cur.links.length < PER_REL) cur.links.push({ slug: m[1].trim(), label })
  }

  return groups
    // 절반 넘게 값이면 그 관계는 사실 목록이다 — 남은 하나 때문에 요약에 올리지 않는다.
    .filter((g) => g.links.length > 0 && g.values * 2 <= g.seen)
    .sort(
      (a, b) =>
        (a.dir === b.dir ? 0 : a.dir === 'out' ? -1 : 1) ||
        (RANK[a.rel] ?? DEFAULT_RANK) - (RANK[b.rel] ?? DEFAULT_RANK) ||
        a.total - b.total ||
        a.rel.localeCompare(b.rel),
    )
    .slice(0, MAX_GROUPS)
}
