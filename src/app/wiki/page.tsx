import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** 링크가 많이 모이는 문서가 곧 그 영역의 들머리다. 별도 목차를 만들지 않는다. */
async function hubs(folderId: string | null, take: number) {
  const rows = await db.page.findMany({
    where: { deletedAt: null, ...(folderId ? { folderId } : {}) },
    select: { slug: true, title: true, summary: true, inLinks: true, outLinks: true },
    take: 400,
    orderBy: { updatedAt: 'desc' },
  })
  return rows
    .map((p) => ({ ...p, degree: p.inLinks.length + p.outLinks.length }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, take)
}

export default async function WikiIndex() {
  const folders = await db.folder.findMany({ orderBy: { name: 'asc' } })
  const counts = await db.page.groupBy({
    by: ['folderId'],
    where: { deletedAt: null },
    _count: true,
  })
  const rootHubs = await hubs(null, 8)
  const perFolder = await Promise.all(
    folders.map(async (f) => ({ folder: f, items: await hubs(f.id, 8) })),
  )

  const countOf = (id: string | null) => counts.find((c) => c.folderId === id)?._count ?? 0

  return (
    <main className="shell">
      <section className="rise" style={{ padding: '2.5rem 0 1.5rem' }}>
        <p className="eyebrow">위키</p>
        <h1>어디서 시작해도 이웃으로 이어진다</h1>
        <p style={{ color: 'var(--text-dim)', maxWidth: '34rem', lineHeight: 1.8 }}>
          아래는 링크가 가장 많이 모이는 문서들이다. 하나를 열고 본문의 링크를 따라가면 나머지가
          이어져 나온다.
        </p>
      </section>

      {perFolder.map(({ folder, items }) => (
        <section key={folder.id} className="rise glass" style={{ padding: '1.2rem 1.4rem', marginBottom: '1rem' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>{folder.name}</h3>
            <span className="chip">문서 {countOf(folder.id).toLocaleString('ko-KR')}</span>
          </div>
          <ul className="list-clean" style={{ marginTop: '0.8rem' }}>
            {items.map((p) => (
              <li key={p.slug}>
                <a href={`/wiki/${p.slug}`}>{p.title}</a>
                <span className="meta" style={{ marginLeft: '0.5rem' }}>
                  연결 {p.degree}
                </span>
              </li>
            ))}
            {items.length === 0 && <li className="meta">문서가 없습니다.</li>}
          </ul>
        </section>
      ))}

      {rootHubs.length > 0 && (
        <section className="rise glass" style={{ padding: '1.2rem 1.4rem' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>폴더 없음</h3>
            <span className="chip">문서 {countOf(null).toLocaleString('ko-KR')}</span>
          </div>
          <ul className="list-clean" style={{ marginTop: '0.8rem' }}>
            {rootHubs.map((p) => (
              <li key={p.slug}>
                <a href={`/wiki/${p.slug}`}>{p.title}</a>
                <span className="meta" style={{ marginLeft: '0.5rem' }}>
                  연결 {p.degree}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
