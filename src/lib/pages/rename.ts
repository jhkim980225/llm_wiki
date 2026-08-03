import { db } from '@/lib/db'
import { parseOutLinks, rewriteWikiLinks } from '@/lib/wiki/links'

/**
 * slug를 바꾸고, 이 페이지를 가리키던 모든 페이지의 본문 [[링크]]를 재작성한다.
 * 링크 재작성은 장부성 쓰기라 참조 페이지의 version을 올리지 않는다 —
 * "페이지가 편집됐다" 신호를 오염시키지 않기 위해서다.
 */
export async function renamePage(oldSlug: string, newSlug: string) {
  return db.$transaction(async (tx) => {
    const page = await tx.page.findUnique({ where: { slug: oldSlug } })
    if (!page) throw new Error(`page not found: ${oldSlug}`)
    if (await tx.page.findUnique({ where: { slug: newSlug } })) {
      throw new Error(`page already exists: ${newSlug}`)
    }

    let rewritten = 0
    for (const referrer of page.inLinks) {
      const ref = await tx.page.findUnique({ where: { slug: referrer } })
      if (!ref) continue
      const content = rewriteWikiLinks(ref.content, oldSlug, newSlug)
      if (content === ref.content) continue
      await tx.page.update({
        where: { slug: referrer },
        data: { content, outLinks: parseOutLinks(content) },
      })
      rewritten++
    }

    // 이 페이지가 가리키던 대상들의 백링크에도 새 이름을 반영한다.
    for (const target of page.outLinks) {
      const t = await tx.page.findUnique({ where: { slug: target } })
      if (!t) continue
      await tx.page.update({
        where: { slug: target },
        data: { inLinks: t.inLinks.map((s) => (s === oldSlug ? newSlug : s)) },
      })
    }

    const updated = await tx.page.update({ where: { slug: oldSlug }, data: { slug: newSlug } })
    await tx.pageRevision.updateMany({ where: { pageId: page.id }, data: { slug: newSlug } })

    return { page: updated, rewritten }
  })
}
