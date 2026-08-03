import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const CARDS = [
  {
    href: '/graph',
    kbd: '01',
    title: '그래프',
    body: '문서 사이의 링크를 별자리처럼 펼친다. 노드를 두 번 누르면 그 문서를 중심으로 다시 그린다.',
  },
  {
    href: '/wiki/index',
    kbd: '02',
    title: '위키',
    body: '[[링크]]로 잇는 마크다운 문서. 백링크와 편집 이력이 따라붙는다.',
  },
  {
    href: '/chat',
    kbd: '03',
    title: '도우미',
    body: '사내 LLM이 문서를 읽고 고친다. 에이전트 편집은 이력에 따로 남는다.',
  },
]

export default async function Home() {
  const [pages, byType, links] = await Promise.all([
    db.page.count({ where: { deletedAt: null } }),
    db.page.groupBy({ by: ['pageType'], where: { deletedAt: null }, _count: true }),
    db.page.findMany({ where: { deletedAt: null }, select: { outLinks: true } }),
  ])
  const linkCount = links.reduce((n, p) => n + p.outLinks.length, 0)

  return (
    <main className="shell">
      <section className="rise" style={{ padding: '3.5rem 0 2rem' }}>
        <p className="eyebrow">지식 그래프 · 사내 위키</p>
        <h1>
          문서는 홀로 있지 않다.
          <br />
          <span style={{ color: 'var(--text-dim)' }}>이어진 모양을 본다.</span>
        </h1>
        <p style={{ color: 'var(--text-dim)', maxWidth: '34rem', lineHeight: 1.8 }}>
          위키 링크 그래프와 외부 Fuseki 지식 그래프를 한 화면에 겹쳐 본다. 레이어는 따로 끄고 켤 수
          있다.
        </p>
      </section>

      <section className="rise glass" style={{ padding: '1.1rem 1.3rem', marginBottom: '2rem' }}>
        <div className="row" style={{ gap: '2.2rem' }}>
          <Stat label="문서" value={pages} />
          <Stat label="링크" value={linkCount} />
          {byType.map((t) => (
            <Stat key={t.pageType} label={t.pageType} value={t._count} dim />
          ))}
        </div>
      </section>

      <section
        style={{
          display: 'grid',
          gap: '1rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))',
        }}
      >
        {CARDS.map((c) => (
          <a
            key={c.href}
            href={c.href}
            className="rise glass"
            style={{ padding: '1.4rem', display: 'block', color: 'inherit' }}
          >
            <span className="eyebrow">{c.kbd}</span>
            <h3 style={{ marginTop: '0.5rem' }}>{c.title}</h3>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.88rem', lineHeight: 1.7, margin: 0 }}>
              {c.body}
            </p>
          </a>
        ))}
      </section>
    </main>
  )
}

function Stat({ label, value, dim }: { label: string; value: number; dim?: boolean }) {
  return (
    <div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: dim ? '1.3rem' : '2rem',
          fontWeight: 700,
          lineHeight: 1.1,
          color: dim ? 'var(--text-dim)' : 'var(--text)',
        }}
      >
        {value}
      </div>
      <div className="eyebrow">{label}</div>
    </div>
  )
}
