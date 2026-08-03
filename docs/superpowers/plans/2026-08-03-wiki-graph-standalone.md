# 위키 + 그래프 독립 앱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** llm_wiki의 위키 기능과 옵시디언식 그래프 뷰를 Next.js/TypeScript 독립 앱으로 재작성하고, 외부 Fuseki 지식 그래프를 두 번째 레이어로 겹쳐 본다.

**Architecture:** Next.js App Router 단일 프로세스. 로직의 핵심(링크 파서·그래프 서브셋 계산·SPARQL 클라이언트)은 I/O 없는 순수 함수 모듈로 두고 Route Handler와 React 컴포넌트가 이를 호출한다. 위키 데이터는 Postgres(Prisma), 개체 그래프는 외부 Fuseki에서 SPARQL로 읽기만 한다.

**Tech Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Prisma + PostgreSQL · d3-force · vitest · marked + dompurify · Vercel AI SDK (openai-compatible → 사내 Ollama)

설계 명세: `docs/superpowers/specs/2026-08-03-wiki-graph-standalone-design.md`
원본 참조 코드: `C:\feda\llm_wiki\weknora`

## Global Constraints

- 패키지 매니저는 `npm`. Node 20 이상
- 멀티테넌트·KB 스코프 없음. 단일 워크스페이스. 어떤 테이블에도 `tenant_id` / `knowledge_base_id` 컬럼을 만들지 않는다
- 인증 없음. 로그인·세션·미들웨어 추가 금지 (v1 범위 밖)
- 문서 업로드·파싱·청킹·임베딩·벡터검색·큐 워커를 만들지 않는다
- Fuseki는 **읽기 전용**. `INSERT`/`DELETE` SPARQL을 보내지 않는다
- 순수 함수 모듈(`lib/wiki/links.ts`, `lib/graph/subset.ts`, `lib/fuseki/client.ts`)은 Prisma나 Next.js를 import 하지 않는다
- 문자열 오프셋 계산은 전부 JS 문자열 인덱스 기준. 한글 포함 테스트 필수
- 커밋 메시지는 Conventional Commits (`feat:` `fix:` `test:` `chore:` `docs:`)

---

## File Structure

```
prisma/schema.prisma            Page / PageRevision / Folder 모델
src/lib/wiki/links.ts           [[링크]] 파싱·주입·재작성 (순수)
src/lib/wiki/slug.ts            slug 정규화·검증 (순수)
src/lib/wiki/diff.ts            리비전 라인 diff (순수)
src/lib/graph/subset.ts         overview/ego 서브그래프 계산 (순수)
src/lib/graph/match.ts          위키 노드 ↔ Fuseki 노드 매칭 (순수)
src/lib/fuseki/client.ts        SPARQL 읽기 클라이언트 (fetch만)
src/lib/db.ts                   Prisma 싱글턴
src/lib/pages/save.ts           저장 트랜잭션 (리비전·링크 동기화·버전)
src/app/api/pages/...           페이지 CRUD Route Handler
src/app/api/folders/...         폴더 CRUD
src/app/api/graph/route.ts      위키 링크 그래프
src/app/api/graph/entities/     Fuseki 개체 그래프
src/app/api/chat/route.ts       에이전트 툴 루프
src/lib/agent/tools.ts          AI SDK 툴 정의
src/components/graph/           canvas 렌더러 + 레이어 토글
src/components/wiki/            브라우저·에디터·리비전 드로어
```

---

### Task 1: 프로젝트 스캐폴드 + DB 스키마

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.example`, `docker-compose.yml`
- Create: `prisma/schema.prisma`
- Create: `src/lib/db.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `prisma` 클라이언트 타입 `Page` `PageRevision` `Folder`, `src/lib/db.ts`의 `export const db: PrismaClient`

- [ ] **Step 1: Next.js 앱 생성**

```bash
npx create-next-app@latest . --ts --app --no-tailwind --no-src-dir=false --eslint --use-npm
npm i @prisma/client d3-force marked dompurify
npm i -D prisma vitest @types/d3-force @types/dompurify
```

- [ ] **Step 2: vitest 설정**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
```

`package.json`에 `"test": "vitest run"` 추가.

- [ ] **Step 3: Prisma 스키마 작성**

`prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Page {
  id             String    @id @default(uuid())
  slug           String    @unique
  title          String
  pageType       String    @default("concept")
  status         String    @default("published")
  content        String    @default("")
  summary        String    @default("")
  aliases        String[]  @default([])
  folderId       String?
  folder         Folder?   @relation(fields: [folderId], references: [id])
  categoryPath   String[]  @default([])
  wikiPath       String    @default("")
  depth          Int       @default(0)
  sortOrder      Int       @default(0)
  inLinks        String[]  @default([])
  outLinks       String[]  @default([])
  metadata       Json      @default("{}")
  version        Int       @default(1)
  lastEditSource String    @default("user")
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  deletedAt      DateTime?

  revisions PageRevision[]

  @@index([pageType])
  @@index([folderId])
  @@index([wikiPath])
  @@index([deletedAt])
}

model PageRevision {
  id         String   @id @default(uuid())
  pageId     String
  page       Page     @relation(fields: [pageId], references: [id], onDelete: Cascade)
  slug       String
  version    Int
  title      String
  content    String
  summary    String
  pageType   String
  status     String
  editSource String   @default("user")
  createdAt  DateTime @default(now())

  @@unique([pageId, version])
  @@index([slug])
}

model Folder {
  id        String   @id @default(uuid())
  parentId  String?
  parent    Folder?  @relation("FolderTree", fields: [parentId], references: [id])
  children  Folder[] @relation("FolderTree")
  name      String
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  pages Page[]

  @@index([parentId])
}
```

- [ ] **Step 4: 로컬 Postgres + 마이그레이션**

`docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: wiki
      POSTGRES_USER: wiki
      POSTGRES_DB: wiki
    ports: ["5433:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
volumes:
  pgdata:
```

`.env.example`:

```
DATABASE_URL=postgres://wiki:wiki@localhost:5433/wiki
FUSEKI_URL=http://192.168.0.100:31406
FUSEKI_DATASET=ds
FUSEKI_USER=
FUSEKI_PASSWORD=
LLM_BASE_URL=http://192.168.0.152:11434/v1
LLM_MODEL=qwen3:14b
```

Run: `docker compose up -d && cp .env.example .env && npx prisma migrate dev --name init`
Expected: 마이그레이션 성공, 테이블 3개 생성

- [ ] **Step 5: Prisma 싱글턴**

`src/lib/db.ts`:

```ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const db = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
```

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: Next.js 스캐폴드와 위키 DB 스키마"
```

---

### Task 2: 링크 파서 — 아웃링크 추출

**Files:**
- Create: `src/lib/wiki/links.ts`
- Test: `src/lib/wiki/links.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `parseOutLinks(content: string): string[]`

원본 참조: `weknora/internal/application/service/wiki_page.go:1002 parseOutLinks`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/wiki/links.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseOutLinks } from './links'

describe('parseOutLinks', () => {
  it('[[slug]] 형태를 뽑는다', () => {
    expect(parseOutLinks('앞 [[entity/acme]] 뒤')).toEqual(['entity/acme'])
  })

  it('[[slug|표시명]]에서 slug만 뽑는다', () => {
    expect(parseOutLinks('[[concept/rag|검색증강생성]]')).toEqual(['concept/rag'])
  })

  it('중복을 한 번만 반환한다', () => {
    expect(parseOutLinks('[[a]] [[a]] [[a|A]]')).toEqual(['a'])
  })

  it('빈 링크와 공백만 있는 링크는 무시한다', () => {
    expect(parseOutLinks('[[]] [[   ]] [[b]]')).toEqual(['b'])
  })

  it('한글 slug를 그대로 뽑는다', () => {
    expect(parseOutLinks('[[개체/마데카소사이드로션]]')).toEqual(['개체/마데카소사이드로션'])
  })

  it('링크가 없으면 빈 배열', () => {
    expect(parseOutLinks('평범한 문장')).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- links`
Expected: FAIL — `parseOutLinks` 없음

- [ ] **Step 3: 최소 구현**

`src/lib/wiki/links.ts`:

```ts
/** [[wiki-link]] 문법 매칭. `]`를 포함하지 않는 내용만 링크로 본다. */
export const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g

/** [[slug]] / [[slug|표시명]]의 내부 텍스트에서 slug 부분만 돌려준다. */
export function extractWikiSlug(inner: string): string {
  const pipe = inner.indexOf('|')
  return (pipe >= 0 ? inner.slice(0, pipe) : inner).trim()
}

/** content 안의 모든 아웃링크 slug를 등장 순서대로, 중복 없이 반환한다. */
export function parseOutLinks(content: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of content.matchAll(WIKI_LINK_RE)) {
    const slug = extractWikiSlug(m[1])
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    out.push(slug)
  }
  return out
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- links`
Expected: PASS 6건

- [ ] **Step 5: 커밋**

```bash
git add src/lib/wiki/links.ts src/lib/wiki/links.test.ts
git commit -m "feat: [[링크]] 아웃링크 파서"
```

---

### Task 3: 링크 파서 — 금지 구간 계산

**Files:**
- Modify: `src/lib/wiki/links.ts`
- Test: `src/lib/wiki/links.test.ts`

**Interfaces:**
- Consumes: `extractWikiSlug`
- Produces: `type Span = { start: number; end: number }`, `computeForbiddenSpans(s: string): { spans: Span[]; linkedSlugs: Set<string> }`

원본 참조: `weknora/internal/application/service/wiki_linkify.go:202 computeForbiddenSpans`

- [ ] **Step 1: 실패하는 테스트 추가**

```ts
import { computeForbiddenSpans } from './links'

const covers = (s: string, spans: { start: number; end: number }[], needle: string) => {
  const at = s.indexOf(needle)
  return spans.some((sp) => sp.start <= at && at + needle.length <= sp.end)
}

describe('computeForbiddenSpans', () => {
  it('펜스 코드블록 전체를 금지한다', () => {
    const s = '앞\n```\nacme 내부\n```\n뒤'
    expect(covers(s, computeForbiddenSpans(s).spans, 'acme 내부')).toBe(true)
  })

  it('물결 펜스도 금지한다', () => {
    const s = '앞\n~~~\nacme\n~~~\n뒤'
    expect(covers(s, computeForbiddenSpans(s).spans, 'acme')).toBe(true)
  })

  it('인라인 코드를 금지한다', () => {
    const s = '이건 `acme` 코드'
    expect(covers(s, computeForbiddenSpans(s).spans, '`acme`')).toBe(true)
  })

  it('기존 위키링크를 금지하고 slug를 수집한다', () => {
    const s = '[[entity/acme|Acme]] 언급'
    const r = computeForbiddenSpans(s)
    expect(covers(s, r.spans, '[[entity/acme|Acme]]')).toBe(true)
    expect(r.linkedSlugs.has('entity/acme')).toBe(true)
  })

  it('마크다운 링크와 이미지를 금지한다', () => {
    const s = '[Acme](http://a) ![Acme](http://b)'
    const spans = computeForbiddenSpans(s).spans
    expect(covers(s, spans, '[Acme](http://a)')).toBe(true)
    expect(covers(s, spans, '![Acme](http://b)')).toBe(true)
  })

  it('자동링크를 금지한다', () => {
    const s = '<http://acme.com>'
    expect(covers(s, computeForbiddenSpans(s).spans, '<http://acme.com>')).toBe(true)
  })

  it('일반 문장은 금지 구간이 없다', () => {
    expect(computeForbiddenSpans('Acme는 회사다').spans).toEqual([])
  })

  it('한글 앞에 있어도 오프셋이 맞는다', () => {
    const s = '한글한글한글 `acme` 끝'
    expect(covers(s, computeForbiddenSpans(s).spans, '`acme`')).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- links`
Expected: FAIL — `computeForbiddenSpans` 없음

- [ ] **Step 3: 구현**

`src/lib/wiki/links.ts`에 추가:

```ts
export type Span = { start: number; end: number }

/**
 * 링크를 주입하면 안 되는 구간을 모은다. 펜스 코드블록, 인라인 코드,
 * 기존 [[위키링크]], 마크다운 링크/이미지, 참조링크와 그 정의, 자동링크.
 * 함께 수집한 linkedSlugs로 "이미 이 slug로 링크됨"을 한 번의 스캔으로 판정한다.
 */
export function computeForbiddenSpans(s: string): { spans: Span[]; linkedSlugs: Set<string> } {
  const spans: Span[] = []
  const linkedSlugs = new Set<string>()

  const push = (start: number, end: number) => {
    if (end > start) spans.push({ start, end })
  }

  // 1) 펜스 코드블록 — 여는 펜스와 같은 문자로 닫힐 때까지. 닫히지 않으면 문서 끝까지.
  const fence = /^[ \t]*(```+|~~~+)[^\n]*$/gm
  let fenceMatch: RegExpExecArray | null
  const fenceRanges: Span[] = []
  while ((fenceMatch = fence.exec(s)) !== null) {
    const marker = fenceMatch[1][0]
    const start = fenceMatch.index
    fence.lastIndex = fenceMatch.index + fenceMatch[0].length
    const closeRe = new RegExp(`^[ \\t]*${marker === '`' ? '```+' : '~~~+'}[ \\t]*$`, 'gm')
    closeRe.lastIndex = fence.lastIndex
    const close = closeRe.exec(s)
    const end = close ? close.index + close[0].length : s.length
    fenceRanges.push({ start, end })
    push(start, end)
    fence.lastIndex = end
  }
  const inFence = (i: number) => fenceRanges.some((r) => r.start <= i && i < r.end)

  // 2) 인라인 코드 — 같은 길이의 백틱 런끼리 짝짓는다.
  const tick = /(`+)([^`]|[^`][\s\S]*?)\1/g
  let t: RegExpExecArray | null
  while ((t = tick.exec(s)) !== null) {
    if (inFence(t.index)) continue
    push(t.index, t.index + t[0].length)
  }

  // 3) 기존 위키링크
  for (const m of s.matchAll(WIKI_LINK_RE)) {
    const at = m.index!
    push(at, at + m[0].length)
    const slug = extractWikiSlug(m[1])
    if (slug && !/\s/.test(slug)) linkedSlugs.add(slug)
  }

  // 4) 인라인 링크 / 이미지 / 참조링크 / 참조정의 / 자동링크
  const patterns = [
    /!?\[[^\]]*\]\([^)]*\)/g, // [t](u) 와 ![a](u)
    /!?\[[^\]]*\]\[[^\]]*\]/g, // [t][l]
    /^[ \t]*\[[^\]]+\]:[^\n]*$/gm, // [l]: url
    /<[a-zA-Z][a-zA-Z0-9+.-]*:[^\s>]*>/g, // <http://...>
  ]
  for (const re of patterns) {
    for (const m of s.matchAll(re)) push(m.index!, m.index! + m[0].length)
  }

  spans.sort((a, b) => a.start - b.start || a.end - b.end)
  return { spans, linkedSlugs }
}

/** [pos, end) 구간이 금지 구간과 겹치는지. */
export function spanContains(spans: Span[], pos: number, end: number): boolean {
  return spans.some((sp) => pos < sp.end && sp.start < end)
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- links`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/wiki/links.ts src/lib/wiki/links.test.ts
git commit -m "feat: 링크 주입 금지 구간 계산"
```

---

### Task 4: 링크 파서 — 교차링크 주입과 rename 재작성

**Files:**
- Modify: `src/lib/wiki/links.ts`
- Test: `src/lib/wiki/links.test.ts`

**Interfaces:**
- Consumes: `computeForbiddenSpans`, `spanContains`, `WIKI_LINK_RE`, `extractWikiSlug`
- Produces:
  - `type LinkRef = { slug: string; matchText: string }`
  - `linkifyContent(content: string, refs: LinkRef[], selfSlug: string): { content: string; changed: boolean }`
  - `rewriteWikiLinks(content: string, oldSlug: string, newSlug: string): string`

원본 참조: `wiki_linkify.go:35 linkifyContent`, `wiki_page.go:1041 rewriteDeadWikiLinks`

- [ ] **Step 1: 실패하는 테스트 추가**

```ts
import { linkifyContent, rewriteWikiLinks } from './links'

describe('linkifyContent', () => {
  const refs = [{ slug: 'entity/acme', matchText: 'Acme' }]

  it('첫 출현만 링크로 감싼다', () => {
    const r = linkifyContent('Acme는 회사다. Acme는 크다.', refs, 'self')
    expect(r.content).toBe('[[entity/acme|Acme]]는 회사다. Acme는 크다.')
    expect(r.changed).toBe(true)
  })

  it('코드블록 안은 건드리지 않는다', () => {
    const src = '```\nAcme\n```\nAcme 본문'
    expect(linkifyContent(src, refs, 'self').content).toBe('```\nAcme\n```\n[[entity/acme|Acme]] 본문')
  })

  it('이미 그 slug로 링크돼 있으면 건너뛴다', () => {
    const src = '[[entity/acme|Acme]] 그리고 Acme'
    expect(linkifyContent(src, refs, 'self').changed).toBe(false)
  })

  it('자기 자신은 링크하지 않는다', () => {
    expect(linkifyContent('Acme', refs, 'entity/acme').changed).toBe(false)
  })

  it('ASCII 단어 경계를 지킨다', () => {
    expect(linkifyContent('Acmecorp만 있다', refs, 'self').changed).toBe(false)
  })

  it('CJK는 경계를 따지지 않는다', () => {
    const cjk = [{ slug: '개체/북경', matchText: '북경' }]
    expect(linkifyContent('북경대학교', cjk, 'self').content).toBe('[[개체/북경|북경]]대학교')
  })

  it('긴 matchText를 먼저 매칭한다', () => {
    const two = [
      { slug: 'e/a', matchText: 'Acme' },
      { slug: 'e/ac', matchText: 'Acme Corp' },
    ]
    expect(linkifyContent('Acme Corp 소개', two, 'self').content).toBe('[[e/ac|Acme Corp]] 소개')
  })

  it('주입 후 뒤쪽 금지 구간 오프셋이 밀린다', () => {
    const src = 'Acme 그리고 `Acme` 코드'
    expect(linkifyContent(src, refs, 'self').content).toBe('[[entity/acme|Acme]] 그리고 `Acme` 코드')
  })
})

describe('rewriteWikiLinks', () => {
  it('slug만 바꾸고 표시명은 보존한다', () => {
    expect(rewriteWikiLinks('[[old|이름]]과 [[old]]', 'old', 'new')).toBe('[[new|이름]]과 [[new]]')
  })

  it('다른 slug는 그대로 둔다', () => {
    expect(rewriteWikiLinks('[[other]]', 'old', 'new')).toBe('[[other]]')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- links`
Expected: FAIL — `linkifyContent` 없음

- [ ] **Step 3: 구현**

```ts
export type LinkRef = { slug: string; matchText: string }

const isAsciiWord = (ch: string) => /[A-Za-z0-9_]/.test(ch)

/** matchText가 ASCII 문자/숫자로 시작하거나 끝나면 단어 경계를 따져야 한다. */
function hasAsciiEdge(s: string): boolean {
  return s.length > 0 && (isAsciiWord(s[0]) || isAsciiWord(s[s.length - 1]))
}

/** pos 직전과 end 위치가 ASCII 단어 문자가 아닌지. CJK는 경계로 취급된다. */
function hasWordBoundary(s: string, pos: number, end: number): boolean {
  const before = pos > 0 ? s[pos - 1] : ''
  const after = end < s.length ? s[end] : ''
  return !isAsciiWord(before) && !isAsciiWord(after)
}

/** 금지 구간을 피하고 필요한 경우 단어 경계를 지키는 첫 출현 위치. 없으면 -1. */
function findFirstSafeMatch(haystack: string, needle: string, forbidden: Span[]): number {
  const needBoundary = hasAsciiEdge(needle)
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) return -1
    const end = at + needle.length
    if (!spanContains(forbidden, at, end) && (!needBoundary || hasWordBoundary(haystack, at, end))) {
      return at
    }
    from = at + 1
  }
}

/**
 * 각 ref의 첫 번째 안전한 출현을 [[slug|matchText]]로 감싼다.
 * 이미 해당 slug로 링크된 ref와 selfSlug를 가리키는 ref는 건너뛴다.
 * 긴 matchText를 먼저 처리해 짧은 것이 긴 것을 잘라먹지 않게 한다.
 */
export function linkifyContent(
  content: string,
  refs: LinkRef[],
  selfSlug: string,
): { content: string; changed: boolean } {
  let out = content
  let changed = false
  let { spans, linkedSlugs } = computeForbiddenSpans(out)

  const ordered = [...refs]
    .filter((r) => r.slug && r.matchText && r.slug !== selfSlug)
    .sort((a, b) => b.matchText.length - a.matchText.length || a.slug.localeCompare(b.slug))

  for (const ref of ordered) {
    if (linkedSlugs.has(ref.slug)) continue
    const at = findFirstSafeMatch(out, ref.matchText, spans)
    if (at < 0) continue

    const replacement = `[[${ref.slug}|${ref.matchText}]]`
    const end = at + ref.matchText.length
    out = out.slice(0, at) + replacement + out.slice(end)
    changed = true

    // 주입으로 뒤쪽 오프셋이 밀렸으므로 금지 구간을 다시 계산한다.
    // ponytail: 전체 재계산이다. refs가 수백 개로 늘면 span 시프트로 바꾼다.
    const recomputed = computeForbiddenSpans(out)
    spans = recomputed.spans
    linkedSlugs = recomputed.linkedSlugs
  }

  return { content: out, changed }
}

/** rename 시 [[oldSlug]] / [[oldSlug|표시명]]의 slug 부분만 newSlug로 바꾼다. */
export function rewriteWikiLinks(content: string, oldSlug: string, newSlug: string): string {
  return content.replace(WIKI_LINK_RE, (whole, inner: string) => {
    const pipe = inner.indexOf('|')
    const slug = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim()
    if (slug !== oldSlug) return whole
    return pipe >= 0 ? `[[${newSlug}|${inner.slice(pipe + 1)}]]` : `[[${newSlug}]]`
  })
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- links`
Expected: PASS 전체

- [ ] **Step 5: 커밋**

```bash
git add src/lib/wiki/links.ts src/lib/wiki/links.test.ts
git commit -m "feat: 교차링크 주입과 rename 링크 재작성"
```

---

### Task 5: 그래프 서브셋 계산

**Files:**
- Create: `src/lib/graph/subset.ts`
- Test: `src/lib/graph/subset.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type GraphPage = { slug: string; title: string; pageType: string; inLinks: string[]; outLinks: string[] }`
  - `type GraphNode = { slug: string; title: string; pageType: string; linkCount: number }`
  - `type GraphEdge = { source: string; target: string }`
  - `type GraphMeta = { mode: string; total: number; returned: number; truncated: boolean; center?: string; depth?: number }`
  - `type GraphRequest = { mode?: 'overview' | 'ego'; center?: string; depth?: number; types?: string[]; limit?: number }`
  - `computeGraphSubset(pages: GraphPage[], req: GraphRequest): { nodes: GraphNode[]; edges: GraphEdge[]; meta: GraphMeta }`

원본 참조: `weknora/internal/application/service/wiki_page.go:592`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/graph/subset.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeGraphSubset, type GraphPage } from './subset'

const page = (slug: string, out: string[], inl: string[], type = 'concept'): GraphPage => ({
  slug, title: slug.toUpperCase(), pageType: type, outLinks: out, inLinks: inl,
})

// a -> b -> c,  d 고립
const pages = [
  page('a', ['b'], []),
  page('b', ['c'], ['a']),
  page('c', [], ['b'], 'entity'),
  page('d', [], []),
]

describe('computeGraphSubset overview', () => {
  it('linkCount 내림차순, 동점은 slug 오름차순', () => {
    const r = computeGraphSubset(pages, {})
    expect(r.nodes.map((n) => n.slug)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('limit으로 자르고 truncated를 세운다', () => {
    const r = computeGraphSubset(pages, { limit: 2 })
    expect(r.nodes).toHaveLength(2)
    expect(r.meta.truncated).toBe(true)
    expect(r.meta.total).toBe(4)
    expect(r.meta.returned).toBe(2)
  })

  it('양 끝이 살아남은 엣지만 남는다', () => {
    const r = computeGraphSubset(pages, { limit: 2 })
    expect(r.edges).toEqual([{ source: 'a', target: 'b' }])
  })

  it('타입 필터가 total도 좁힌다', () => {
    const r = computeGraphSubset(pages, { types: ['entity'] })
    expect(r.nodes.map((n) => n.slug)).toEqual(['c'])
    expect(r.meta.total).toBe(1)
    expect(r.meta.truncated).toBe(false)
  })

  it('두 번 호출해도 순서가 같다', () => {
    const a = computeGraphSubset(pages, {})
    const b = computeGraphSubset(pages, {})
    expect(a.nodes).toEqual(b.nodes)
  })
})

describe('computeGraphSubset ego', () => {
  it('depth 1은 직접 이웃까지', () => {
    const r = computeGraphSubset(pages, { mode: 'ego', center: 'a', depth: 1 })
    expect(r.nodes.map((n) => n.slug).sort()).toEqual(['a', 'b'])
  })

  it('depth 2는 한 단계 더', () => {
    const r = computeGraphSubset(pages, { mode: 'ego', center: 'a', depth: 2 })
    expect(r.nodes.map((n) => n.slug).sort()).toEqual(['a', 'b', 'c'])
  })

  it('inLinks 방향으로도 퍼진다', () => {
    const r = computeGraphSubset(pages, { mode: 'ego', center: 'c', depth: 1 })
    expect(r.nodes.map((n) => n.slug).sort()).toEqual(['b', 'c'])
  })

  it('타입 필터가 탐색 경로를 막지 않는다', () => {
    const r = computeGraphSubset(pages, { mode: 'ego', center: 'a', depth: 2, types: ['entity'] })
    expect(r.nodes.map((n) => n.slug)).toContain('c')
  })

  it('ego의 total은 전체 페이지 수', () => {
    const r = computeGraphSubset(pages, { mode: 'ego', center: 'a', depth: 1 })
    expect(r.meta.total).toBe(4)
    expect(r.meta.center).toBe('a')
  })

  it('center가 없으면 던진다', () => {
    expect(() => computeGraphSubset(pages, { mode: 'ego' })).toThrow(/center/)
  })

  it('center가 존재하지 않으면 던진다', () => {
    expect(() => computeGraphSubset(pages, { mode: 'ego', center: 'zz' })).toThrow(/not found/)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- subset`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/lib/graph/subset.ts`:

```ts
export type GraphPage = {
  slug: string
  title: string
  pageType: string
  inLinks: string[]
  outLinks: string[]
}

export type GraphNode = { slug: string; title: string; pageType: string; linkCount: number }
export type GraphEdge = { source: string; target: string }
export type GraphMeta = {
  mode: string
  total: number
  returned: number
  truncated: boolean
  center?: string
  depth?: number
}
export type GraphRequest = {
  mode?: 'overview' | 'ego'
  center?: string
  depth?: number
  types?: string[]
  limit?: number
}

/** center에서 depth 단계까지 양방향 BFS. 타입 필터는 후보 채택에만 쓰고 탐색은 막지 않는다. */
function bfsEgo(
  bySlug: Map<string, GraphPage>,
  center: string,
  depth: number,
  typeAllow: Set<string>,
  limit: number,
): Set<string> {
  const selected = new Set<string>([center])
  let frontier = [center]

  for (let d = 0; d < depth; d++) {
    const next: string[] = []
    for (const slug of frontier) {
      const p = bySlug.get(slug)
      if (!p) continue
      for (const nb of [...p.outLinks, ...p.inLinks]) {
        if (!bySlug.has(nb) || selected.has(nb)) continue
        const nbPage = bySlug.get(nb)!
        // 필터가 걸려 있으면 중심 외 노드는 허용 타입만 채택한다.
        if (typeAllow.size > 0 && !typeAllow.has(nbPage.pageType)) continue
        if (limit > 0 && selected.size >= limit) return selected
        selected.add(nb)
        next.push(nb)
      }
    }
    if (next.length === 0) break
    frontier = next
  }
  return selected
}

/**
 * 전체 페이지에서 요청한 서브그래프를 잘라낸다. I/O 없음.
 * overview: 타입 필터 통과분을 linkCount 내림차순(동점은 slug)으로 정렬 후 limit 절단.
 * ego: center에서 depth 단계 BFS.
 */
export function computeGraphSubset(
  pages: GraphPage[],
  req: GraphRequest,
): { nodes: GraphNode[]; edges: GraphEdge[]; meta: GraphMeta } {
  const mode = req.mode ?? 'overview'
  const typeAllow = new Set((req.types ?? []).filter(Boolean))
  const limit = req.limit ?? 0

  const bySlug = new Map<string, GraphPage>()
  const linkCount = new Map<string, number>()
  for (const p of pages) {
    bySlug.set(p.slug, p)
    linkCount.set(p.slug, p.inLinks.length + p.outLinks.length)
  }

  let selected: Set<string>
  let total: number

  if (mode === 'ego') {
    if (!req.center) throw new Error('ego graph requires a center slug')
    if (!bySlug.has(req.center)) throw new Error(`ego center slug "${req.center}" not found`)
    const depth = Math.max(1, req.depth ?? 1)
    selected = bfsEgo(bySlug, req.center, depth, typeAllow, limit)
    total = pages.length
  } else {
    const candidates = pages.filter((p) => typeAllow.size === 0 || typeAllow.has(p.pageType))
    total = candidates.length
    const sorted = [...candidates].sort((x, y) => {
      const lx = linkCount.get(x.slug)!
      const ly = linkCount.get(y.slug)!
      return ly - lx || (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0)
    })
    const capped = limit > 0 ? sorted.slice(0, limit) : sorted
    selected = new Set(capped.map((p) => p.slug))
  }

  const nodes: GraphNode[] = [...selected].map((slug) => {
    const p = bySlug.get(slug)!
    return { slug, title: p.title, pageType: p.pageType, linkCount: linkCount.get(slug)! }
  })
  nodes.sort((a, b) => b.linkCount - a.linkCount || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))

  const edges: GraphEdge[] = []
  for (const p of pages) {
    if (!selected.has(p.slug)) continue
    for (const target of p.outLinks) {
      if (selected.has(target)) edges.push({ source: p.slug, target })
    }
  }

  return {
    nodes,
    edges,
    meta: {
      mode,
      total,
      returned: nodes.length,
      truncated: nodes.length < total,
      ...(mode === 'ego' ? { center: req.center, depth: Math.max(1, req.depth ?? 1) } : {}),
    },
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- subset`
Expected: PASS 전체

- [ ] **Step 5: 커밋**

```bash
git add src/lib/graph/subset.ts src/lib/graph/subset.test.ts
git commit -m "feat: overview/ego 그래프 서브셋 계산"
```

---

### Task 6: 페이지 저장 트랜잭션

**Files:**
- Create: `src/lib/pages/save.ts`
- Test: `src/lib/pages/save.test.ts`

**Interfaces:**
- Consumes: `db`, `parseOutLinks`
- Produces:
  - `class VersionConflictError extends Error { currentVersion: number }`
  - `savePage(input: { slug: string; expectedVersion: number; title?: string; content?: string; summary?: string; pageType?: string; status?: string; editSource?: 'user' | 'agent' | 'revert' }): Promise<Page>`
  - `syncBacklinks(tx, slug: string, before: string[], after: string[]): Promise<void>`
  - `VISIBLE_FIELDS: readonly ['title', 'content', 'summary', 'pageType', 'status']`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/pages/save.test.ts` — 실제 DB를 쓴다. `.env.test`에 별도 DATABASE_URL을 두고 각 테스트 전 테이블을 비운다.

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { savePage, VersionConflictError } from './save'

const reset = async () => {
  await db.pageRevision.deleteMany()
  await db.page.deleteMany()
}

const seed = (slug: string, content = '') =>
  db.page.create({ data: { slug, title: slug, content, outLinks: [], inLinks: [] } })

describe('savePage', () => {
  beforeEach(reset)

  it('가시 필드가 바뀌면 version이 오른다', async () => {
    await seed('a')
    const r = await savePage({ slug: 'a', expectedVersion: 1, content: '새 본문' })
    expect(r.version).toBe(2)
  })

  it('내용이 같으면 version이 그대로다', async () => {
    await seed('a', '같음')
    const r = await savePage({ slug: 'a', expectedVersion: 1, content: '같음' })
    expect(r.version).toBe(1)
  })

  it('편집 전 상태가 리비전에 남는다', async () => {
    await seed('a', '옛날')
    await savePage({ slug: 'a', expectedVersion: 1, content: '새것' })
    const revs = await db.pageRevision.findMany({ where: { slug: 'a' } })
    expect(revs).toHaveLength(1)
    expect(revs[0].content).toBe('옛날')
    expect(revs[0].version).toBe(1)
  })

  it('version이 어긋나면 충돌로 던진다', async () => {
    await seed('a')
    await expect(savePage({ slug: 'a', expectedVersion: 99, content: 'x' })).rejects.toBeInstanceOf(
      VersionConflictError,
    )
  })

  it('아웃링크가 대상 페이지의 백링크로 반영된다', async () => {
    await seed('a')
    await seed('b')
    await savePage({ slug: 'a', expectedVersion: 1, content: '[[b]] 참조' })
    const b = await db.page.findUnique({ where: { slug: 'b' } })
    expect(b!.inLinks).toEqual(['a'])
  })

  it('링크를 지우면 백링크도 사라진다', async () => {
    await seed('a')
    await seed('b')
    await savePage({ slug: 'a', expectedVersion: 1, content: '[[b]]' })
    await savePage({ slug: 'a', expectedVersion: 2, content: '링크 없음' })
    const b = await db.page.findUnique({ where: { slug: 'b' } })
    expect(b!.inLinks).toEqual([])
  })

  it('존재하지 않는 대상 링크는 저장은 되고 백링크만 안 생긴다', async () => {
    await seed('a')
    const r = await savePage({ slug: 'a', expectedVersion: 1, content: '[[없음]]' })
    expect(r.outLinks).toEqual(['없음'])
  })

  it('editSource가 agent면 그대로 기록된다', async () => {
    await seed('a')
    const r = await savePage({ slug: 'a', expectedVersion: 1, content: 'x', editSource: 'agent' })
    expect(r.lastEditSource).toBe('agent')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- save`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/lib/pages/save.ts`:

```ts
import type { Page, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { parseOutLinks } from '@/lib/wiki/links'

/** 이 필드들이 실제로 바뀔 때만 version을 올린다. 링크 유지보수는 장부성 쓰기다. */
export const VISIBLE_FIELDS = ['title', 'content', 'summary', 'pageType', 'status'] as const

export class VersionConflictError extends Error {
  constructor(public currentVersion: number) {
    super(`version conflict: server is at ${currentVersion}`)
    this.name = 'VersionConflictError'
  }
}

/** before에서 사라진 대상의 백링크를 빼고, after에 새로 생긴 대상에 더한다. */
export async function syncBacklinks(
  tx: Prisma.TransactionClient,
  slug: string,
  before: string[],
  after: string[],
): Promise<void> {
  const removed = before.filter((s) => !after.includes(s))
  const added = after.filter((s) => !before.includes(s))

  for (const target of removed) {
    const p = await tx.page.findUnique({ where: { slug: target } })
    if (!p) continue
    await tx.page.update({
      where: { slug: target },
      data: { inLinks: p.inLinks.filter((s) => s !== slug) },
    })
  }
  for (const target of added) {
    const p = await tx.page.findUnique({ where: { slug: target } })
    if (!p || p.inLinks.includes(slug)) continue
    await tx.page.update({ where: { slug: target }, data: { inLinks: [...p.inLinks, slug] } })
  }
}

export type SaveInput = {
  slug: string
  expectedVersion: number
  title?: string
  content?: string
  summary?: string
  pageType?: string
  status?: string
  editSource?: 'user' | 'agent' | 'revert'
}

/**
 * 한 트랜잭션 안에서: 낙관적 잠금 확인 → 편집 전 스냅샷 저장 →
 * 아웃링크 재계산 → 양방향 백링크 동기화 → 가시 필드가 바뀐 경우만 version++.
 */
export async function savePage(input: SaveInput): Promise<Page> {
  return db.$transaction(async (tx) => {
    const current = await tx.page.findUnique({ where: { slug: input.slug } })
    if (!current) throw new Error(`page not found: ${input.slug}`)
    if (current.version !== input.expectedVersion) throw new VersionConflictError(current.version)

    const next = {
      title: input.title ?? current.title,
      content: input.content ?? current.content,
      summary: input.summary ?? current.summary,
      pageType: input.pageType ?? current.pageType,
      status: input.status ?? current.status,
    }
    const visibleChanged = VISIBLE_FIELDS.some((f) => next[f] !== current[f])

    if (visibleChanged) {
      await tx.pageRevision.create({
        data: {
          pageId: current.id,
          slug: current.slug,
          version: current.version,
          title: current.title,
          content: current.content,
          summary: current.summary,
          pageType: current.pageType,
          status: current.status,
          editSource: current.lastEditSource,
        },
      })
    }

    const outLinks = parseOutLinks(next.content)
    await syncBacklinks(tx, current.slug, current.outLinks, outLinks)

    return tx.page.update({
      where: { slug: current.slug },
      data: {
        ...next,
        outLinks,
        version: visibleChanged ? current.version + 1 : current.version,
        lastEditSource: visibleChanged ? (input.editSource ?? 'user') : current.lastEditSource,
      },
    })
  })
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- save`
Expected: PASS 8건

- [ ] **Step 5: 커밋**

```bash
git add src/lib/pages/save.ts src/lib/pages/save.test.ts
git commit -m "feat: 페이지 저장 트랜잭션 (리비전·백링크·낙관적 잠금)"
```

---

### Task 7: 페이지 REST API

**Files:**
- Create: `src/app/api/pages/route.ts` (GET 목록, POST 생성)
- Create: `src/app/api/pages/[slug]/route.ts` (GET, PUT, DELETE)
- Create: `src/app/api/pages/[slug]/rename/route.ts` (POST)
- Create: `src/app/api/pages/[slug]/revisions/route.ts` (GET 목록)
- Create: `src/app/api/pages/[slug]/revert/route.ts` (POST)
- Create: `src/app/api/search/route.ts` (GET)

**Interfaces:**
- Consumes: `savePage`, `VersionConflictError`, `rewriteWikiLinks`, `db`
- Produces: HTTP 계약
  - `GET /api/pages?type=&folderId=&limit=&offset=` → `{ items: Page[]; total: number }`
  - `POST /api/pages` body `{ slug, title, content?, pageType?, folderId? }` → `Page` (409 = slug 중복)
  - `GET /api/pages/[slug]` → `Page & { backlinks: {slug,title}[] }`
  - `PUT /api/pages/[slug]` body `SaveInput` 나머지 → `Page`, 충돌 시 409 `{ error, currentVersion }`
  - `DELETE /api/pages/[slug]` → `{ ok: true }` (soft delete + 백링크 정리)
  - `POST /api/pages/[slug]/rename` body `{ newSlug }` → `{ page, rewritten: number }`
  - `GET /api/pages/[slug]/revisions` → `{ items: PageRevision[] }`
  - `POST /api/pages/[slug]/revert` body `{ version }` → `Page` (editSource=`revert`)
  - `GET /api/search?q=&limit=` → `{ items: {slug,title,summary}[] }`

- [ ] **Step 1: rename 동작 테스트 작성**

`src/app/api/pages/rename.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { renamePage } from '@/lib/pages/rename'

beforeEach(async () => {
  await db.pageRevision.deleteMany()
  await db.page.deleteMany()
})

describe('renamePage', () => {
  it('참조하던 페이지의 본문 링크를 새 slug로 고친다', async () => {
    await db.page.create({ data: { slug: 'old', title: 'Old', outLinks: [], inLinks: ['ref'] } })
    await db.page.create({
      data: { slug: 'ref', title: 'Ref', content: '[[old|옛이름]]', outLinks: ['old'], inLinks: [] },
    })

    const r = await renamePage('old', 'new')

    expect(r.rewritten).toBe(1)
    const ref = await db.page.findUnique({ where: { slug: 'ref' } })
    expect(ref!.content).toBe('[[new|옛이름]]')
    expect(ref!.outLinks).toEqual(['new'])
  })

  it('새 slug가 이미 있으면 던진다', async () => {
    await db.page.create({ data: { slug: 'a', title: 'A', outLinks: [], inLinks: [] } })
    await db.page.create({ data: { slug: 'b', title: 'B', outLinks: [], inLinks: [] } })
    await expect(renamePage('a', 'b')).rejects.toThrow(/exists/)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- rename`
Expected: FAIL — `@/lib/pages/rename` 없음

- [ ] **Step 3: rename 구현**

`src/lib/pages/rename.ts`:

```ts
import { db } from '@/lib/db'
import { parseOutLinks, rewriteWikiLinks } from '@/lib/wiki/links'

/**
 * slug를 바꾸고, 이 페이지를 가리키던 모든 페이지의 본문 [[링크]]를 재작성한다.
 * 링크 재작성은 장부성 쓰기라 참조 페이지의 version을 올리지 않는다.
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

    const updated = await tx.page.update({ where: { slug: oldSlug }, data: { slug: newSlug } })
    await tx.pageRevision.updateMany({ where: { pageId: page.id }, data: { slug: newSlug } })

    // 이 페이지가 가리키던 대상들의 백링크에도 새 이름을 반영한다.
    for (const target of page.outLinks) {
      const t = await tx.page.findUnique({ where: { slug: target } })
      if (!t) continue
      await tx.page.update({
        where: { slug: target },
        data: { inLinks: t.inLinks.map((s) => (s === oldSlug ? newSlug : s)) },
      })
    }

    return { page: updated, rewritten }
  })
}
```

- [ ] **Step 4: 통과 확인 후 Route Handler 작성**

Run: `npm test -- rename` → PASS

`src/app/api/pages/[slug]/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { savePage, VersionConflictError } from '@/lib/pages/save'

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = await db.page.findFirst({ where: { slug, deletedAt: null } })
  if (!page) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const backlinks = await db.page.findMany({
    where: { slug: { in: page.inLinks }, deletedAt: null },
    select: { slug: true, title: true },
  })
  return NextResponse.json({ ...page, backlinks })
}

export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const body = await req.json()
  try {
    return NextResponse.json(await savePage({ ...body, slug }))
  } catch (e) {
    if (e instanceof VersionConflictError) {
      return NextResponse.json(
        { error: 'version conflict', currentVersion: e.currentVersion },
        { status: 409 },
      )
    }
    throw e
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  await db.$transaction(async (tx) => {
    const page = await tx.page.findUnique({ where: { slug } })
    if (!page) return
    for (const target of page.outLinks) {
      const t = await tx.page.findUnique({ where: { slug: target } })
      if (!t) continue
      await tx.page.update({
        where: { slug: target },
        data: { inLinks: t.inLinks.filter((s) => s !== slug) },
      })
    }
    await tx.page.update({ where: { slug }, data: { deletedAt: new Date() } })
  })
  return NextResponse.json({ ok: true })
}
```

나머지 핸들러(목록·생성·검색·리비전·되돌리기·rename)도 같은 형태로 작성한다. 검색은 v1에서 `contains` + `mode: 'insensitive'`로 title·summary·content를 훑는다.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/pages src/app/api
git commit -m "feat: 페이지 REST API (CRUD·rename·리비전·검색)"
```

---

### Task 8: 그래프 API + canvas 뷰 (위키 레이어)

**Files:**
- Create: `src/app/api/graph/route.ts`
- Create: `src/components/graph/ForceCanvas.tsx`
- Create: `src/components/graph/GraphView.tsx`
- Create: `src/app/graph/page.tsx`

**Interfaces:**
- Consumes: `computeGraphSubset`, `db`
- Produces:
  - `GET /api/graph?mode=&center=&depth=&types=&limit=` → `{ nodes, edges, meta }`
  - `<ForceCanvas nodes edges onNodeClick />` — d3-force 시뮬레이션 + canvas 렌더링

- [ ] **Step 1: 그래프 Route Handler**

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computeGraphSubset } from '@/lib/graph/subset'

const DEFAULT_LIMIT = 500
const MAX_LIMIT = 2000
const MAX_DEPTH = 3

export async function GET(req: Request) {
  const u = new URL(req.url)
  const clamp = (v: string | null, def: number, max: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def
  }

  const pages = await db.page.findMany({
    where: { deletedAt: null },
    select: { slug: true, title: true, pageType: true, inLinks: true, outLinks: true },
  })

  try {
    const result = computeGraphSubset(pages, {
      mode: u.searchParams.get('mode') === 'ego' ? 'ego' : 'overview',
      center: u.searchParams.get('center') ?? undefined,
      depth: clamp(u.searchParams.get('depth'), 1, MAX_DEPTH),
      types: u.searchParams.get('types')?.split(',').filter(Boolean) ?? [],
      limit: clamp(u.searchParams.get('limit'), DEFAULT_LIMIT, MAX_LIMIT),
    })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
```

- [ ] **Step 2: ForceCanvas 구현**

d3-force로 물리만 돌리고 그리기는 직접 한다.

```tsx
'use client'
import { useEffect, useRef } from 'react'
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force'

export type CanvasNode = { id: string; label: string; group: string; size: number; x?: number; y?: number }
export type CanvasEdge = { source: string; target: string; dashed?: boolean }

export function ForceCanvas({
  nodes, edges, colorOf, onNodeClick,
}: {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  colorOf: (group: string) => string
  onNodeClick?: (id: string) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)

    const sim = forceSimulation(nodes as never[])
      .force('link', forceLink(edges as never[]).id((d: never) => (d as CanvasNode).id).distance(60))
      .force('charge', forceManyBody().strength(-160))
      .force('center', forceCenter(w / 2, h / 2))
      .force('collide', forceCollide<CanvasNode>().radius((d) => d.size + 4))
      .on('tick', draw)

    function draw() {
      ctx.clearRect(0, 0, w, h)
      ctx.lineWidth = 1
      for (const e of edges as unknown as { source: CanvasNode; target: CanvasNode; dashed?: boolean }[]) {
        ctx.beginPath()
        ctx.setLineDash(e.dashed ? [4, 4] : [])
        ctx.strokeStyle = e.dashed ? '#9aa0a6' : '#d0d4d9'
        ctx.moveTo(e.source.x!, e.source.y!)
        ctx.lineTo(e.target.x!, e.target.y!)
        ctx.stroke()
      }
      ctx.setLineDash([])
      for (const n of nodes) {
        ctx.beginPath()
        ctx.fillStyle = colorOf(n.group)
        ctx.arc(n.x!, n.y!, n.size, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#333'
        ctx.font = '11px sans-serif'
        ctx.fillText(n.label, n.x! + n.size + 3, n.y! + 3)
      }
    }

    const hit = (ev: MouseEvent) => {
      const r = canvas.getBoundingClientRect()
      const mx = ev.clientX - r.left
      const my = ev.clientY - r.top
      const found = nodes.find((n) => Math.hypot(n.x! - mx, n.y! - my) <= n.size + 3)
      if (found && onNodeClick) onNodeClick(found.id)
    }
    canvas.addEventListener('click', hit)

    return () => {
      canvas.removeEventListener('click', hit)
      sim.stop()
    }
  }, [nodes, edges, colorOf, onNodeClick])

  return <canvas ref={ref} style={{ width: '100%', height: '100%' }} />
}
```

- [ ] **Step 3: GraphView에서 overview/ego 전환·타입 범례·fit 버튼 배선**

노드 클릭 → 페이지 열기, 노드 더블클릭 → 해당 slug를 center로 ego 모드 재조회.

- [ ] **Step 4: 수동 확인**

Run: `npm run dev` 후 `/graph`
Expected: 노드가 퍼지고, 검색으로 포커스되고, 클릭하면 페이지로 이동

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/graph src/components/graph src/app/graph
git commit -m "feat: 위키 링크 그래프 API와 canvas 뷰"
```

---

### Task 9: Fuseki 클라이언트

**Files:**
- Create: `src/lib/fuseki/client.ts`
- Test: `src/lib/fuseki/client.test.ts`

**Interfaces:**
- Consumes: 없음 (fetch만)
- Produces:
  - `escapeLiteral(s: string): string`
  - `type EntityNode = { uri: string; label: string }`
  - `type EntityEdge = { source: string; target: string; relation: string }`
  - `searchEntities(labels: string[], opts?: { namespace?: string }): Promise<{ nodes: EntityNode[]; edges: EntityEdge[] }>`
  - `fusekiHealth(): Promise<boolean>`

원본 참조: `weknora/internal/application/repository/retriever/fuseki/repository.go`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { escapeLiteral, searchEntities } from './client'

afterEach(() => vi.unstubAllGlobals())

describe('escapeLiteral', () => {
  it('역슬래시·따옴표·개행을 이스케이프한다', () => {
    expect(escapeLiteral('a"b\\c\nd')).toBe('a\\"b\\\\c\\nd')
  })

  it('SPARQL 인젝션 시도를 문자열 안에 가둔다', () => {
    expect(escapeLiteral('" } INSERT DATA { <a> <b> "')).not.toContain('" }')
  })
})

describe('searchEntities', () => {
  const results = {
    results: {
      bindings: [
        {
          s: { value: 'urn:node:acme' }, sl: { value: 'Acme' },
          p: { value: 'urn:weknora:rel:거래' },
          o: { value: 'urn:node:beta' }, ol: { value: 'Beta' },
        },
      ],
    },
  }

  it('바인딩을 노드와 엣지로 바꾼다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(results), { status: 200 })))
    const r = await searchEntities(['Acme'])
    expect(r.nodes).toEqual([
      { uri: 'urn:node:acme', label: 'Acme' },
      { uri: 'urn:node:beta', label: 'Beta' },
    ])
    expect(r.edges).toEqual([
      { source: 'urn:node:acme', target: 'urn:node:beta', relation: '거래' },
    ])
  })

  it('라벨이 없으면 요청을 보내지 않는다', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await searchEntities([])).toEqual({ nodes: [], edges: [] })
    expect(spy).not.toHaveBeenCalled()
  })

  it('Fuseki가 죽으면 던진다 (호출자가 degrade 판단)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    await expect(searchEntities(['Acme'])).rejects.toThrow(/500/)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- fuseki`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
const LABEL_PREDICATE = 'http://www.w3.org/2000/01/rdf-schema#label'
const REL_NS = 'urn:weknora:rel:'

export type EntityNode = { uri: string; label: string }
export type EntityEdge = { source: string; target: string; relation: string }

/** SPARQL 이중따옴표 리터럴 안에서 안전하도록 이스케이프한다. */
export function escapeLiteral(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

const cfg = () => ({
  url: process.env.FUSEKI_URL ?? '',
  dataset: process.env.FUSEKI_DATASET ?? 'ds',
  user: process.env.FUSEKI_USER ?? '',
  password: process.env.FUSEKI_PASSWORD ?? '',
})

async function sparqlQuery(q: string): Promise<{ results: { bindings: Record<string, { value: string }>[] } }> {
  const c = cfg()
  const headers: Record<string, string> = {
    'Content-Type': 'application/sparql-query',
    Accept: 'application/sparql-results+json',
  }
  if (c.user) headers.Authorization = 'Basic ' + Buffer.from(`${c.user}:${c.password}`).toString('base64')

  const res = await fetch(`${c.url}/${c.dataset}/query`, { method: 'POST', headers, body: q })
  if (!res.ok) throw new Error(`fuseki query failed: ${res.status}`)
  return res.json()
}

/** 라벨에 검색어가 포함된 개체와 그 관계 엣지를 가져온다. */
export async function searchEntities(
  labels: string[],
  opts: { namespace?: string } = {},
): Promise<{ nodes: EntityNode[]; edges: EntityEdge[] }> {
  const terms = labels.filter(Boolean)
  if (terms.length === 0) return { nodes: [], edges: [] }

  const conds = terms.flatMap((t) => {
    const lit = escapeLiteral(t)
    return [`CONTAINS(?sl, "${lit}")`, `CONTAINS(?ol, "${lit}")`]
  })
  const inner =
    `?s ?p ?o .\n` +
    `?s <${LABEL_PREDICATE}> ?sl .\n` +
    `?o <${LABEL_PREDICATE}> ?ol .\n` +
    `FILTER(STRSTARTS(STR(?p), "${escapeLiteral(REL_NS)}"))\n` +
    `FILTER(${conds.join(' || ')})`
  const pattern = opts.namespace ? `GRAPH <${opts.namespace}> {\n${inner}\n}` : inner

  const data = await sparqlQuery(`SELECT DISTINCT ?s ?sl ?p ?o ?ol WHERE {\n${pattern}\n}`)

  const nodes = new Map<string, EntityNode>()
  const edges: EntityEdge[] = []
  for (const b of data.results.bindings) {
    if (!nodes.has(b.s.value)) nodes.set(b.s.value, { uri: b.s.value, label: b.sl.value })
    if (!nodes.has(b.o.value)) nodes.set(b.o.value, { uri: b.o.value, label: b.ol.value })
    edges.push({
      source: b.s.value,
      target: b.o.value,
      relation: b.p.value.slice(REL_NS.length),
    })
  }
  return { nodes: [...nodes.values()], edges }
}

/** 연결 확인. 실패해도 던지지 않는다. */
export async function fusekiHealth(): Promise<boolean> {
  try {
    await sparqlQuery('ASK { ?s ?p ?o }')
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- fuseki`
Expected: PASS 5건

- [ ] **Step 5: 커밋**

```bash
git add src/lib/fuseki
git commit -m "feat: Fuseki SPARQL 읽기 클라이언트"
```

---

### Task 10: 레이어 매칭 + 개체 레이어 합성

**Files:**
- Create: `src/lib/graph/match.ts`
- Test: `src/lib/graph/match.test.ts`
- Create: `src/app/api/graph/entities/route.ts`
- Modify: `src/components/graph/GraphView.tsx`

**Interfaces:**
- Consumes: `searchEntities`, `fusekiHealth`, `GraphNode`
- Produces:
  - `normalizeLabel(s: string): string`
  - `matchLayers(pages: {slug,title,aliases}[], entities: EntityNode[]): { pageSlug: string; entityUri: string }[]`
  - `GET /api/graph/entities?labels=a,b` → `{ nodes, edges, error?: string }`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, it, expect } from 'vitest'
import { normalizeLabel, matchLayers } from './match'

describe('normalizeLabel', () => {
  it('트림·소문자·공백단일화', () => {
    expect(normalizeLabel('  Acme   Corp ')).toBe('acme corp')
  })
})

describe('matchLayers', () => {
  const pages = [
    { slug: 'e/acme', title: 'Acme Corp', aliases: ['에이크미'] },
    { slug: 'e/beta', title: 'Beta', aliases: [] },
  ]

  it('title 완전일치를 잇는다', () => {
    const r = matchLayers(pages, [{ uri: 'urn:1', label: 'acme corp' }])
    expect(r).toEqual([{ pageSlug: 'e/acme', entityUri: 'urn:1' }])
  })

  it('alias 완전일치도 잇는다', () => {
    const r = matchLayers(pages, [{ uri: 'urn:2', label: ' 에이크미 ' }])
    expect(r).toEqual([{ pageSlug: 'e/acme', entityUri: 'urn:2' }])
  })

  it('부분일치는 잇지 않는다', () => {
    expect(matchLayers(pages, [{ uri: 'urn:3', label: 'Acme' }])).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인 → 구현**

```ts
import type { EntityNode } from '@/lib/fuseki/client'

/** 두 레이어의 이름을 비교 가능한 형태로 맞춘다. 트림·소문자·연속공백 단일화. */
export function normalizeLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * 페이지의 title 또는 alias가 Fuseki 노드 라벨과 **완전히** 같을 때만 잇는다.
 * ponytail: 부분일치·임베딩 유사도는 오탐이 그래프를 못 쓰게 만들어서 뺐다.
 * 매칭 품질이 부족하면 여기만 바꾸면 된다.
 */
export function matchLayers(
  pages: { slug: string; title: string; aliases: string[] }[],
  entities: EntityNode[],
): { pageSlug: string; entityUri: string }[] {
  const byName = new Map<string, string>()
  for (const p of pages) {
    for (const name of [p.title, ...p.aliases]) {
      const key = normalizeLabel(name)
      if (key && !byName.has(key)) byName.set(key, p.slug)
    }
  }
  const out: { pageSlug: string; entityUri: string }[] = []
  for (const e of entities) {
    const slug = byName.get(normalizeLabel(e.label))
    if (slug) out.push({ pageSlug: slug, entityUri: e.uri })
  }
  return out
}
```

- [ ] **Step 3: 개체 Route Handler — Fuseki 장애를 삼킨다**

```ts
import { NextResponse } from 'next/server'
import { searchEntities } from '@/lib/fuseki/client'

export async function GET(req: Request) {
  const labels = new URL(req.url).searchParams.get('labels')?.split(',').filter(Boolean) ?? []
  try {
    return NextResponse.json(await searchEntities(labels))
  } catch (e) {
    // 위키 레이어는 계속 살아 있어야 한다. 200으로 빈 결과 + 사유.
    return NextResponse.json({ nodes: [], edges: [], error: (e as Error).message })
  }
}
```

- [ ] **Step 4: GraphView에 레이어 토글 배선**

체크박스 2개(위키 링크 / 개체). 개체 레이어를 켜면 현재 보이는 페이지들의 title+aliases를 labels로 보내 조회하고, `matchLayers` 결과를 점선 엣지로 그린다. `error`가 오면 토글 옆에 "Fuseki 레이어 사용 불가"를 띄우고 위키 레이어는 그대로 둔다.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/graph/match.ts src/lib/graph/match.test.ts src/app/api/graph/entities src/components/graph
git commit -m "feat: Fuseki 개체 레이어와 레이어 간 노드 매칭"
```

---

### Task 11: 위키 UI (브라우저·에디터·리비전)

**Files:**
- Create: `src/components/wiki/PageTree.tsx`, `PageEditor.tsx`, `PageView.tsx`, `BacklinkPanel.tsx`, `RevisionDrawer.tsx`
- Create: `src/lib/wiki/diff.ts`, `src/lib/wiki/diff.test.ts`
- Create: `src/app/wiki/[...slug]/page.tsx`

**Interfaces:**
- Consumes: 페이지 REST API, `marked`, `dompurify`
- Produces: `lineDiff(a: string, b: string): { type: 'same'|'add'|'del'; text: string }[]`

- [ ] **Step 1: diff 테스트 → 구현**

```ts
import { describe, it, expect } from 'vitest'
import { lineDiff } from './diff'

describe('lineDiff', () => {
  it('같은 줄은 same', () => {
    expect(lineDiff('a\nb', 'a\nb')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'same', text: 'b' },
    ])
  })

  it('추가된 줄은 add', () => {
    expect(lineDiff('a', 'a\nb')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'add', text: 'b' },
    ])
  })

  it('삭제된 줄은 del', () => {
    expect(lineDiff('a\nb', 'a')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
    ])
  })
})
```

LCS 기반 줄 단위 diff로 구현한다 (원본 `wikiLineDiff.ts`와 동일한 계약).

- [ ] **Step 2: 마크다운 렌더 + 위키링크 처리**

`[[slug]]` / `[[slug|표시명]]`을 렌더 전에 `<a href="/wiki/slug">`로 바꾼다. 존재하지 않는 slug는 `class="dead"`를 붙여 붉게 표시하고, 클릭하면 그 slug로 새 페이지 생성 화면을 연다. 렌더 결과는 반드시 `dompurify`로 통과시킨다.

- [ ] **Step 3: 에디터 — 낙관적 잠금 UX**

저장 시 현재 `version`을 함께 보낸다. 409를 받으면 서버 본문과의 `lineDiff`를 보여주고 "덮어쓰기 / 취소"를 사용자에게 맡긴다. 자동 병합하지 않는다.

- [ ] **Step 4: 수동 확인**

Run: `npm run dev`
Expected: 페이지 생성 → `[[링크]]` 입력 → 대상 페이지 백링크 패널에 출처가 뜬다 → 편집 후 리비전 드로어에서 diff 확인 → 되돌리기 동작

- [ ] **Step 5: 커밋**

```bash
git add src/components/wiki src/lib/wiki/diff.ts src/lib/wiki/diff.test.ts src/app/wiki
git commit -m "feat: 위키 브라우저·에디터·리비전 UI"
```

---

### Task 12: 에이전트 툴 + 채팅 패널

**Files:**
- Create: `src/lib/agent/tools.ts`
- Create: `src/app/api/chat/route.ts`
- Create: `src/components/chat/ChatPanel.tsx`
- Test: `src/lib/agent/tools.test.ts`

**Interfaces:**
- Consumes: `savePage`, `renamePage`, `searchEntities`, `db`
- Produces: AI SDK 툴 `wiki_search` `wiki_read_page` `wiki_write_page` `wiki_replace_text` `wiki_rename_page` `wiki_delete_page` `wiki_link_mutation` `query_knowledge_graph`

- [ ] **Step 1: 읽기 예산 테스트 작성**

```ts
import { describe, it, expect } from 'vitest'
import { budgetContent, READ_BUDGET } from './tools'

describe('budgetContent', () => {
  it('예산 안이면 그대로', () => {
    expect(budgetContent('짧음')).toEqual({ text: '짧음', truncated: false })
  })

  it('예산을 넘으면 자르고 표시한다', () => {
    const long = 'a'.repeat(READ_BUDGET + 100)
    const r = budgetContent(long)
    expect(r.truncated).toBe(true)
    expect(r.text.length).toBeLessThanOrEqual(READ_BUDGET + 64)
    expect(r.text).toContain('잘렸습니다')
  })
})
```

- [ ] **Step 2: 실패 확인 → 구현**

```ts
import { tool } from 'ai'
import { z } from 'zod'
import { db } from '@/lib/db'
import { savePage } from '@/lib/pages/save'
import { renamePage } from '@/lib/pages/rename'
import { searchEntities } from '@/lib/fuseki/client'

/** LLM 컨텍스트를 지키기 위한 페이지 읽기 상한 (문자 수). */
export const READ_BUDGET = 12000

export function budgetContent(text: string): { text: string; truncated: boolean } {
  if (text.length <= READ_BUDGET) return { text, truncated: false }
  return {
    text: text.slice(0, READ_BUDGET) + '\n\n…이하 잘렸습니다.',
    truncated: true,
  }
}

export const wikiTools = {
  wiki_search: tool({
    description: '제목·요약·본문에서 위키 페이지를 검색한다.',
    parameters: z.object({ query: z.string(), limit: z.number().max(20).default(10) }),
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
        select: { slug: true, title: true, summary: true },
        take: limit,
      }),
  }),

  wiki_read_page: tool({
    description: '위키 페이지 본문을 읽는다. 긴 페이지는 잘린다.',
    parameters: z.object({ slug: z.string() }),
    execute: async ({ slug }) => {
      const p = await db.page.findFirst({ where: { slug, deletedAt: null } })
      if (!p) return { error: 'not found' }
      const { text, truncated } = budgetContent(p.content)
      return { slug: p.slug, title: p.title, version: p.version, content: text, truncated }
    },
  }),

  wiki_write_page: tool({
    description: '페이지를 생성하거나 본문을 통째로 교체한다.',
    parameters: z.object({
      slug: z.string(),
      title: z.string(),
      content: z.string(),
      summary: z.string().optional(),
      pageType: z.string().optional(),
    }),
    execute: async (args) => {
      const existing = await db.page.findUnique({ where: { slug: args.slug } })
      if (!existing) {
        return db.page.create({
          data: { ...args, summary: args.summary ?? '', lastEditSource: 'agent' },
        })
      }
      return savePage({ ...args, expectedVersion: existing.version, editSource: 'agent' })
    },
  }),

  query_knowledge_graph: tool({
    description: 'Fuseki 지식 그래프에서 개체와 관계를 조회한다.',
    parameters: z.object({ labels: z.array(z.string()).min(1) }),
    execute: async ({ labels }) => {
      try {
        return await searchEntities(labels)
      } catch (e) {
        return { nodes: [], edges: [], error: (e as Error).message }
      }
    },
  }),
}
```

`wiki_replace_text` · `wiki_rename_page` · `wiki_delete_page` · `wiki_link_mutation`도 같은 형태로 추가한다. 전부 `editSource: 'agent'`로 기록한다.

- [ ] **Step 3: 채팅 Route Handler**

```ts
import { streamText } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { wikiTools } from '@/lib/agent/tools'

const provider = createOpenAICompatible({ name: 'ollama', baseURL: process.env.LLM_BASE_URL! })

export async function POST(req: Request) {
  const { messages } = await req.json()
  const result = streamText({
    model: provider(process.env.LLM_MODEL ?? 'qwen3:14b'),
    messages,
    tools: wikiTools,
    maxSteps: 12,
  })
  return result.toDataStreamResponse()
}
```

- [ ] **Step 4: 수동 확인**

Run: `npm run dev`, 채팅에서 "Acme 페이지 만들어줘"
Expected: 페이지가 생기고 리비전 히스토리에 `agent`로 기록된다

- [ ] **Step 5: 커밋**

```bash
git add src/lib/agent src/app/api/chat src/components/chat
git commit -m "feat: 위키 편집 에이전트 툴과 채팅 패널"
```

---

## Self-Review

**명세 커버리지**

| 명세 항목 | 담당 태스크 |
|---|---|
| 3장 데이터 모델 | Task 1 |
| 4.1 링크 파서 | Task 2·3·4 |
| 4.2 그래프 계산 | Task 5 |
| 4.3 Fuseki 클라이언트 | Task 9 |
| 4.4 두 레이어 그래프 뷰 | Task 8·10 |
| 4.5 에이전트 툴 | Task 12 |
| 5장 저장 흐름 | Task 6 |
| 6장 에러 처리 | Task 6(409)·Task 10(Fuseki 장애)·Task 11(깨진 링크)·Task 7(폴더 순환은 폴더 API에서) |
| 7장 테스트 | 각 태스크의 Step 1 |

**미구현 남김**: 폴더 CRUD와 순환 검증은 Task 7의 "나머지 핸들러"에 포함된다. 명세 6장의 폴더 순환 400 응답은 그 핸들러에서 조상 체인을 훑어 처리한다.
