import { db } from '@/lib/db'
import { extractTerms, retrieve, writeDoc, sanitizeDraftLinks } from '@/lib/rag/compose'
import { createOrRevivePage } from '@/lib/pages/save'
import { normalizeSlug } from '@/lib/wiki/slug'

export type RunFlowInput = {
  /** 참조할 양식(템플릿) 문서 slug */
  templateSlug: string
  /** 무엇을 작성할지 지시 (예: "이번 주 주간업무내역을 작성해줘") */
  instruction: string
  /** 저장 폴더 — id 우선, 없으면 이름으로 찾고(없으면 생성) */
  targetFolderId?: string | null
  targetFolderName?: string | null
}

export type RunFlowResult = { slug: string; title: string }

/** 이름으로 폴더를 찾고 없으면 최상위에 만든다. (폴더는 전역 — 워크스페이스 스코프 아님) */
async function resolveFolder(id?: string | null, name?: string | null): Promise<string | null> {
  if (id) return id
  if (!name) return null
  const found = await db.folder.findFirst({ where: { name } })
  if (found) return found.id
  const created = await db.folder.create({ data: { name } })
  return created.id
}

/** slug 충돌 시 접미사(-2, -3…)로 비켜 준다. 재실행마다 새 문서가 쌓인다. */
async function uniqueSlug(base: string): Promise<string> {
  const root = normalizeSlug(base) || 'flow-doc'
  for (let i = 1; i < 100; i++) {
    const slug = i === 1 ? root : `${root}-${i}`
    const exists = await db.page.findFirst({ where: { slug, deletedAt: null }, select: { id: true } })
    if (!exists) return slug
  }
  return `${root}-${Date.now()}`
}

/**
 * 템플릿(양식) 문서를 참조해 지시대로 새 문서를 작성하고 지정 폴더에 저장한다.
 * 근거는 기존 그래프 RAG(retrieve)로 붙이고, 생성은 writeDoc을 재사용하되
 * 요청에 [양식]을 넣어 그 구조를 그대로 따르게 한다. FLOW(스케줄)의 실행 엔진이기도 하다.
 */
export async function runFlow(input: RunFlowInput): Promise<RunFlowResult> {
  const template = await db.page.findFirst({
    where: { slug: input.templateSlug, deletedAt: null },
    select: { title: true, content: true },
  })
  if (!template) throw new Error(`template not found: ${input.templateSlug}`)

  const folderId = await resolveFolder(input.targetFolderId, input.targetFolderName)

  const request =
    `${input.instruction}\n\n` +
    `아래 [양식]을 반드시 그대로 따라 작성하라 — 제목·표·항목 구조를 유지하고, 자리표시자를 실제 내용으로 채운다.\n\n` +
    `[양식: ${template.title}]\n${template.content}`

  const terms = await extractTerms(input.instruction)
  const retrieved = await retrieve(input.instruction, terms)
  const draft = await sanitizeDraftLinks(await writeDoc(request, retrieved))

  const slug = await uniqueSlug(draft.title || template.title)
  const page = await createOrRevivePage({
    slug,
    title: draft.title || template.title,
    content: draft.content,
    summary: draft.summary,
    folderId,
    editSource: 'agent',
  })
  return { slug: page.slug, title: page.title }
}
