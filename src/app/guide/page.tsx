import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Markdown } from '@/components/wiki/Markdown'

/**
 * 사이트 내 사용자 가이드 — docs/manual/사용자-매뉴얼.md를 그대로 렌더한다.
 * 매뉴얼이 단일 소스: 여기서 내용을 따로 관리하지 않는다.
 *
 * force-static이라 md 읽기는 빌드 시점 — standalone 이미지에 docs/가 없어도 된다.
 * 캡처는 public/manual/img/ 복사본을 쓴다(맨 <img>에는 basePath가 안 붙어서 직접 접두).
 */
export const dynamic = 'force-static'

export default async function GuidePage() {
  const raw = await readFile(
    path.join(process.cwd(), 'docs', 'manual', '사용자-매뉴얼.md'),
    'utf8',
  )
  const md = raw.replaceAll('](img/', '](/graphwiki/manual/img/')
  return (
    <>
      <div className="tabbar">
        <div className="tab on">
          <span className="name">사용자 가이드</span>
        </div>
        <span className="center" />
        <span className="side meta">docs/manual/사용자-매뉴얼.md 기준</span>
      </div>
      <div className="doc">
        <Markdown content={md} />
      </div>
    </>
  )
}
