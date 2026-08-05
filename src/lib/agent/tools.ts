import { tool } from 'ai'
import { z } from 'zod'
import { db } from '@/lib/db'
import { savePage, VersionConflictError, createOrRevivePage } from '@/lib/pages/save'
import { renamePage } from '@/lib/pages/rename'
import { normalizeSlug } from '@/lib/wiki/slug'
import { searchGraphs, nodeAttributes } from '@/lib/fuseki/client'
import { findSource } from '@/lib/ontology/source'
import { embed, toVectorLiteral } from '@/lib/llm/embed'

/** LLM 컨텍스트를 지키기 위한 페이지 읽기 상한 (문자 수). */
export const READ_BUDGET = 12000

export function budgetContent(text: string): { text: string; truncated: boolean } {
  if (text.length <= READ_BUDGET) return { text, truncated: false }
  return { text: text.slice(0, READ_BUDGET) + '\n\n…이하 잘렸습니다.', truncated: true }
}

/** 에이전트 쓰기는 전부 이 값으로 기록돼 리비전 이력에서 사람 편집과 구분된다. */
const AGENT = 'agent' as const

/** 속성까지 읽을 개체 수. 회의록 본문 같은 긴 리터럴이라 몇 개만 읽어도 컨텍스트를 먹는다. */
const ATTR_NODES = 5

export type Attributed = {
  uri: string
  label: string
  source: string
  attributes: { name: string; value: string }[]
}

/**
 * 개체 몇 개의 속성을 동시에 읽는다. 그래프에서 근거(회의록 본문·문서 전문)를
 * 꺼내는 통로라 RAG와 채팅 툴이 같은 함수를 쓴다. 실패한 개체는 조용히 빠진다.
 */
export async function attributesFor(
  targets: { uri: string; label: string; source: string }[],
  limit = ATTR_NODES,
): Promise<Attributed[]> {
  // 같은 개체가 여러 술어로 걸릴 수 있어 URI로 접는다.
  const unique = [...new Map(targets.map((t) => [t.uri, t])).values()].slice(0, limit)

  const settled = await Promise.allSettled(
    unique.map(async (t) => {
      const src = findSource(t.source)
      if (!src) return null
      return { ...t, attributes: await nodeAttributes(t.uri, src) }
    }),
  )

  return settled.flatMap((r) =>
    r.status === 'fulfilled' && r.value ? [r.value as Attributed] : [],
  )
}

export const wikiTools = {
  wiki_search: tool({
    description: '제목·요약·본문에서 위키 페이지를 검색한다.',
    inputSchema: z.object({
      query: z.string().describe('검색어'),
      limit: z.number().int().min(1).max(20).default(10),
    }),
    execute: async ({ query, limit }) =>
      db.page.findMany({
        where: {
          deletedAt: null,
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { summary: { contains: query, mode: 'insensitive' } },
            { content: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: { slug: true, title: true, summary: true, pageType: true },
        take: limit,
      }),
  }),

  wiki_semantic_search: tool({
    description:
      '의미(임베딩)로 위키 페이지를 검색한다. 정확한 단어가 안 겹쳐도 뜻이 가까운 문서를 찾는다. 키워드가 애매하거나 관련 개념을 넓게 모을 때 wiki_search 대신 쓴다.',
    inputSchema: z.object({
      query: z.string().describe('찾고 싶은 내용/개념'),
      limit: z.number().int().min(1).max(20).default(10),
    }),
    execute: async ({ query, limit }) => {
      try {
        const vec = toVectorLiteral(await embed(query))
        return await db.$queryRaw`
          SELECT slug, title, summary, "pageType",
                 1 - (embedding <=> ${vec}::vector) AS score
          FROM "Page"
          WHERE "deletedAt" IS NULL AND embedding IS NOT NULL
          ORDER BY embedding <=> ${vec}::vector
          LIMIT ${limit}`
      } catch (e) {
        return { error: `semantic search unavailable: ${(e as Error).message}` }
      }
    },
  }),

  wiki_read_page: tool({
    description: '위키 페이지 본문을 읽는다. 긴 페이지는 잘려서 온다.',
    inputSchema: z.object({ slug: z.string() }),
    execute: async ({ slug }) => {
      const p = await db.page.findFirst({ where: { slug, deletedAt: null } })
      if (!p) return { error: `page not found: ${slug}` }
      const { text, truncated } = budgetContent(p.content)
      return {
        slug: p.slug,
        title: p.title,
        version: p.version,
        summary: p.summary,
        content: text,
        truncated,
        outLinks: p.outLinks,
        inLinks: p.inLinks,
      }
    },
  }),

  wiki_write_page: tool({
    description: '페이지를 새로 만들거나 본문을 통째로 교체한다.',
    inputSchema: z.object({
      slug: z.string(),
      title: z.string(),
      content: z.string(),
      summary: z.string().optional(),
      pageType: z.string().optional(),
    }),
    execute: async (args) => {
      const slug = normalizeSlug(args.slug)
      if (!slug) return { error: 'slug is empty after normalization' }

      const existing = await db.page.findFirst({ where: { slug, deletedAt: null } })
      if (!existing) {
        // 삭제된 동명 페이지가 있으면 되살린다.
        const created = await createOrRevivePage({
          slug,
          title: args.title,
          content: args.content,
          summary: args.summary,
          pageType: args.pageType,
          editSource: AGENT,
        })
        return { slug: created.slug, version: created.version, created: true }
      }

      try {
        const updated = await savePage({
          slug,
          expectedVersion: existing.version,
          title: args.title,
          content: args.content,
          summary: args.summary,
          pageType: args.pageType,
          editSource: AGENT,
        })
        return { slug: updated.slug, version: updated.version, created: false }
      } catch (e) {
        if (e instanceof VersionConflictError) {
          return { error: 'version conflict', currentVersion: e.currentVersion }
        }
        throw e
      }
    },
  }),

  wiki_replace_text: tool({
    description: '페이지 본문에서 특정 문자열을 찾아 바꾼다. 본문 전체를 다시 쓰지 않을 때 쓴다.',
    inputSchema: z.object({
      slug: z.string(),
      find: z.string().describe('찾을 문자열. 정확히 한 번만 나와야 한다.'),
      replace: z.string(),
    }),
    execute: async ({ slug, find, replace }) => {
      const p = await db.page.findFirst({ where: { slug, deletedAt: null } })
      if (!p) return { error: `page not found: ${slug}` }

      const occurrences = p.content.split(find).length - 1
      if (occurrences === 0) return { error: 'find string not present' }
      // 여러 번 나오면 어디를 고칠지 모호하다 — 호출자가 더 긴 문맥을 주게 만든다.
      if (occurrences > 1) return { error: `find string appears ${occurrences} times; make it unique` }

      const updated = await savePage({
        slug,
        expectedVersion: p.version,
        content: p.content.replace(find, replace),
        editSource: AGENT,
      })
      return { slug, version: updated.version }
    },
  }),

  wiki_rename_page: tool({
    description: '페이지 slug를 바꾸고 이 페이지를 가리키던 모든 [[링크]]를 고친다.',
    inputSchema: z.object({ slug: z.string(), newSlug: z.string() }),
    execute: async ({ slug, newSlug }) => {
      const target = normalizeSlug(newSlug)
      if (!target) return { error: 'newSlug is empty after normalization' }
      try {
        const r = await renamePage(slug, target)
        return { slug: r.page.slug, rewritten: r.rewritten }
      } catch (e) {
        return { error: (e as Error).message }
      }
    },
  }),

  wiki_delete_page: tool({
    description: '페이지를 삭제한다 (soft delete). 이 페이지를 가리키던 링크는 죽은 링크로 남는다.',
    inputSchema: z.object({ slug: z.string() }),
    execute: async ({ slug }) => {
      const p = await db.page.findFirst({ where: { slug, deletedAt: null } })
      if (!p) return { error: `page not found: ${slug}` }

      await db.$transaction(async (tx) => {
        if (p.outLinks.length > 0) {
          await tx.$executeRaw`
            UPDATE "Page" SET "inLinks" = array_remove("inLinks", ${slug})
            WHERE slug = ANY(${p.outLinks}::text[])`
        }
        await tx.page.update({ where: { slug }, data: { deletedAt: new Date() } })
      })
      return { slug, deleted: true }
    },
  }),

  wiki_link_mutation: tool({
    description: '한 페이지 본문에 [[링크]]를 추가하거나 제거한다.',
    inputSchema: z.object({
      slug: z.string(),
      action: z.enum(['add', 'remove']),
      targetSlug: z.string(),
      displayText: z.string().optional().describe('add일 때 표시명. 없으면 targetSlug를 쓴다.'),
    }),
    execute: async ({ slug, action, targetSlug, displayText }) => {
      const p = await db.page.findFirst({ where: { slug, deletedAt: null } })
      if (!p) return { error: `page not found: ${slug}` }

      let content = p.content
      if (action === 'add') {
        if (p.outLinks.includes(targetSlug)) return { error: 'link already present' }
        const label = displayText ?? targetSlug
        content = content.trimEnd() + `\n\n[[${targetSlug}|${label}]]\n`
      } else {
        // [[target]] 와 [[target|표시명]] 두 형태를 모두 걷어낸다.
        const escaped = targetSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        content = content.replace(new RegExp(`\\[\\[${escaped}(\\|[^\\]]*)?\\]\\]`, 'g'), '')
        if (content === p.content) return { error: 'link not present' }
      }

      const updated = await savePage({
        slug,
        expectedVersion: p.version,
        content,
        editSource: AGENT,
      })
      return { slug, version: updated.version, outLinks: updated.outLinks }
    },
  }),

  /** 속성까지 가져올 개체 수. 회의록 본문 같은 긴 리터럴이라 몇 개만 읽어도 컨텍스트를 먹는다. */
  query_knowledge_graph: tool({
    description:
      '사내 지식 그래프 3개(이메일 온톨로지·카카오 지식그래프·승훈 온톨로지)에 한 번에 물어 개체와 관계를 가져온다. ' +
      '개체 이름으로 먼저 찾고, 이름으로 못 찾으면 문서 본문·속성 텍스트까지 뒤져 textHits로 돌려준다. ' +
      '결과마다 출처(source)가 붙는다. 위키 본문에 없는 사실을 확인할 때 쓴다.',
    inputSchema: z.object({
      labels: z.array(z.string()).min(1).describe('찾을 개체 이름들'),
      withAttributes: z
        .boolean()
        .default(false)
        .describe('찾은 개체들의 속성(회의록 본문 등 긴 텍스트 포함)까지 읽을지'),
    }),
    execute: async ({ labels, withAttributes }) => {
      // 한 소스가 죽어도 나머지는 돌려준다. searchGraphs가 소스별 성패를 함께 준다.
      const graph = await searchGraphs(labels)
      if (!withAttributes) return graph

      // 라벨로 못 찾았을 때는 nodes가 비고 textHits만 찬다("글리세롤"이 그 경우다).
      // 거기서도 속성을 읽어야 근거가 생긴다.
      const targets = graph.nodes.length > 0 ? graph.nodes : graph.textHits
      if (targets.length === 0) return graph

      return { ...graph, attributes: await attributesFor(targets) }
    },
  }),
}
