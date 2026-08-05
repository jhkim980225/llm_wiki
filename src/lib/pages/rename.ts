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

    // 참조 페이지를 한 번에 읽어 온다(대상마다 findUnique 하던 N 왕복 제거).
    // 본문 재작성은 페이지마다 내용이 달라 update는 개별이지만, 실제로 바뀐 것만 쓴다.
    let rewritten = 0
    const referrers = await tx.page.findMany({ where: { slug: { in: page.inLinks } } })
    for (const ref of referrers) {
      const content = rewriteWikiLinks(ref.content, oldSlug, newSlug)
      if (content === ref.content) continue
      await tx.page.update({
        where: { slug: ref.slug },
        data: { content, outLinks: parseOutLinks(content) },
      })
      rewritten++
    }

    // 이 페이지가 가리키던 대상들의 백링크 배열에서 oldSlug→newSlug를 한 방에 치환한다.
    if (page.outLinks.length > 0) {
      await tx.$executeRaw`
        UPDATE "Page" SET "inLinks" = array_replace("inLinks", ${oldSlug}, ${newSlug})
        WHERE slug = ANY(${page.outLinks}::text[])`
    }

    const updated = await tx.page.update({ where: { slug: oldSlug }, data: { slug: newSlug } })
    await tx.pageRevision.updateMany({ where: { pageId: page.id }, data: { slug: newSlug } })

    return { page: updated, rewritten }
  })
}
