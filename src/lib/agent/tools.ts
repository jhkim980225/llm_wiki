import { tool } from 'ai'
import { z } from 'zod'
import { db } from '@/lib/db'
import { savePage, VersionConflictError, syncBacklinks } from '@/lib/pages/save'
import { renamePage } from '@/lib/pages/rename'
import { normalizeSlug } from '@/lib/wiki/slug'
import { parseOutLinks } from '@/lib/wiki/links'
import { searchEntities, nodeAttributes } from '@/lib/fuseki/client'

/** LLM 컨텍스트를 지키기 위한 페이지 읽기 상한 (문자 수). */
export const READ_BUDGET = 12000

export function budgetContent(text: string): { text: string; truncated: boolean } {
  if (text.length <= READ_BUDGET) return { text, truncated: false }
  return { text: text.slice(0, READ_BUDGET) + '\n\n…이하 잘렸습니다.', truncated: true }
}

/** 에이전트 쓰기는 전부 이 값으로 기록돼 리비전 이력에서 사람 편집과 구분된다. */
const AGENT = 'agent' as const

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

      const existing = await db.page.findUnique({ where: { slug } })
      if (!existing) {
        const outLinks = parseOutLinks(args.content)
        const created = await db.$transaction(async (tx) => {
          const page = await tx.page.create({
            data: {
              slug,
              title: args.title,
              content: args.content,
              summary: args.summary ?? '',
              pageType: args.pageType ?? 'concept',
              outLinks,
              lastEditSource: AGENT,
            },
          })
          await syncBacklinks(tx, slug, [], outLinks)
          return page
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
        for (const targetSlug of p.outLinks) {
          const t = await tx.page.findUnique({ where: { slug: targetSlug } })
          if (!t) continue
          await tx.page.update({
            where: { slug: targetSlug },
            data: { inLinks: t.inLinks.filter((s) => s !== slug) },
          })
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

  query_knowledge_graph: tool({
    description: '외부 Fuseki 지식 그래프에서 개체와 관계를 조회한다. 위키 본문에 없는 관계를 물을 때 쓴다.',
    inputSchema: z.object({
      labels: z.array(z.string()).min(1).describe('찾을 개체 이름들'),
      withAttributes: z.boolean().default(false).describe('첫 개체의 속성까지 가져올지'),
    }),
    execute: async ({ labels, withAttributes }) => {
      try {
        const graph = await searchEntities(labels)
        if (!withAttributes || graph.nodes.length === 0) return graph
        const attributes = await nodeAttributes(graph.nodes[0].uri)
        return { ...graph, attributes }
      } catch (e) {
        // Fuseki가 죽어도 대화는 계속돼야 한다.
        return { nodes: [], edges: [], error: (e as Error).message }
      }
    },
  }),
}
