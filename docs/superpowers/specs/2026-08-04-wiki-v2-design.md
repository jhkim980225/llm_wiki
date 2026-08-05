# Wiki Graph v2 설계 — 현 코드 기준 재작성

2026-08-04 · 이전 명세 `2026-08-03-wiki-graph-standalone-design.md`를 대체한다.

## 0. 왜 다시 쓰는가

이전 명세는 이 프로젝트의 중심을 **"두 레이어 그래프 뷰"**(위키 링크 그래프 + Fuseki 지식
그래프를 canvas에 겹쳐 그리기)로 서술했다. 그 방향은 구현 도중 두 번 뒤집혔다.

- `7bbd4f4` — 온톨로지를 **그래프로 그리는 대신 위키 문서로 물질화**하기로 했다.
  개체 하나가 문서 하나가 되고, 관계는 본문에 `[[링크]]`로 적힌다.
- `70a9604` — 옵시디언식 볼트 UI로 갈아엎으면서 그래프 뷰를 **통째로 삭제**했다.
  `/graph`, `/api/graph`, `lib/graph/*`, `components/graph/*`, `/wiki` 들머리가 함께 사라졌다.

그래서 이전 명세와 README는 없는 기능을 설명하는 문서가 됐다. 이 문서가 현 코드의 진실이다.

**그래프 뷰는 되살리지 않는다.** 개체는 이제 그림 속 노드가 아니라 걸어 들어갈 수 있는
문서 자체다.

## 1. 이 앱이 하는 일

사내 Fuseki 온톨로지를 위키 문서로 들여와, 옵시디언처럼 문서를 오가며 읽고 고치는 앱.
현재 용도는 **사내 데모/PoC**다.

| 항목 | 값 |
|---|---|
| 스택 | Next.js 16 App Router · React 19 · TypeScript · Prisma + PostgreSQL |
| 인증 | 없음. 단일 워크스페이스 |
| 외부 의존 | Fuseki (SPARQL **읽기 전용**) · 사내 vLLM (OpenAI 호환) |
| 에디터 | markdown textarea + `marked` + `dompurify` |
| 실측 규모 | 문서 97,015건 (이메일 온톨로지 72,186 · 승훈 온톨로지 24,822) |

핵심 로직은 I/O 없는 순수 함수 모듈(`lib/wiki/*`)로 두고 Route Handler와 컴포넌트가 호출한다.
그래서 테스트가 Prisma와 Next를 거치지 않는다.

## 2. 데이터 모델

`prisma/schema.prisma` 참조. `Page` / `PageRevision` / `Folder` 셋.

알아둘 점:

- `version`은 **가시 필드**(`title` `content` `summary` `pageType` `status`)가 실제로 바뀔 때만
  오른다(`lib/pages/save.ts:114`). 링크 유지보수·경로 재계산 같은 장부성 쓰기는 "편집됨" 신호를
  오염시키지 않는다.
- `lastEditSource` ∈ `user` `agent` `revert` `ontology`. 온톨로지 재적재는 값이 `ontology`인
  문서만 갱신한다(`lib/ontology/import.ts:85`).
- `folderId`가 위치의 단일 진실이다. `categoryPath` / `wikiPath` / `depth`는 거기서 유도한 캐시다.
- soft delete. `slug` 유니크 인덱스는 삭제된 행에도 걸리므로, 같은 이름을 다시 쓰려면
  `createOrRevivePage`가 그 행을 되살린다.

**캐시 컬럼의 현실:** `categoryPath`만 실제로 읽힌다(`/api/ontology`가 소스별 문서 수를 셀 때).
`wikiPath`와 `depth`는 지금 아무도 안 읽는다. 지우려면 마이그레이션이 필요해 v2에서는 두었다.

## 3. 화면

| 경로 | 하는 일 |
|---|---|
| `/` | 빈 상태. 왼쪽 트리에서 고르거나 Ctrl+K |
| `/wiki` | `/`로 리다이렉트 |
| `/wiki/<slug>` | 문서 보기·편집·이력. 없으면 그 자리에서 만들기 |
| `/sources` | 온톨로지 소스 목록과 적재 |
| `/chat` | 위키를 고치는 LLM 도우미 |

전 화면이 `<Vault>` 껍데기(레일 + 사이드바 + 본문) 안에 있다.

**모든 이동이 맨 `<a href>`다.** `next/link`도 `useRouter`도 쓰지 않는다. 이건 우연이 아니라
제약이다 — 본문의 위키링크는 `dangerouslySetInnerHTML`로 뿌리므로 `next/link`가 될 수 없고,
일부만 클라이언트 전환으로 바꾸면 상태 수명이 경로마다 달라져 더 헷갈린다.
그래서 **컴포넌트 상태로 화면 사이를 잇지 않는다** (탭이 localStorage에 사는 이유다).

## 4. v2에서 더한 것

### 4.1 링크 잇기 — `lib/pages/linkify.ts`

본문에 이름이 나오는 다른 문서를 찾아 첫 출현을 `[[링크]]`로 감싼다.
**저장할 때 자동으로 하지 않는다** — 편집기 버튼을 누르면 diff 미리보기가 뜨고 사용자가 고른다.

후보 좁히기는 Postgres 한 방(`position(title IN $content) > 0`). 97k행에 **45ms**.

| 규칙 | 이유 |
|---|---|
| `char_length(title) >= 3` | 2자 온톨로지 라벨("판매", "값")은 거의 모든 문서에 걸린다 |
| `aliases`는 안 본다 | `ontology/build.ts:141`이 거기에 RDF 타입명("제품", "조직")을 넣는다 — 동의어가 아니다 |
| 대소문자 구분 | `linkifyContent`의 `indexOf`와 같은 술어여야 SQL과 TS가 안 어긋난다 |
| 제목이 겹치면 같은 소스 우선, 그래도 둘이면 버림 | 라벨 충돌 시 slug에 `-2`가 붙고, 소스가 여럿이면 "미생물"이 소스마다 있다 |
| `LIMIT 50` | 적용 후 저장하면 `syncBacklinks`가 새 링크당 순차 왕복 2회를 5초짜리 트랜잭션 안에서 돈다 |

코드 블록·이미 걸린 링크·마크다운 링크는 `computeForbiddenSpans`가 막는다(기존 순수 함수).

온톨로지 문서를 편집하면 `lastEditSource`가 `user`가 되어 **다음 재적재에서 영영 건너뛴다.**
편집기가 그 사실을 경고로 띄운다. 조용히 우회하지 않는다.

### 4.2 검색 — `api/search/route.ts`

한국어라 부분문자열 매칭이 유일하게 맞다. 그래서 **tsvector도 pg_trgm도 안 쓴다**:

- tsvector는 한국어 토크나이저가 없다. `to_tsvector('simple','삼성전자의')`는 토큰 하나를 낳고
  `삼성전자` 질의가 안 걸린다.
- pg_trgm GIN은 2~3자 질의에서 트라이그램이 안 뽑혀 플래너가 인덱스를 못 쓴다.
  그런데 한국어에서 가장 흔한 질의 길이가 정확히 그 구간이다.

진짜 결함은 스캔이 아니라 **`ORDER BY`가 없어 물리 순서로 잘리던 것**이었다. 랭킹이 수정의 전부다:
제목 정확일치 → 제목 접두 → 제목 포함 → 요약 포함 → 본문 포함.

2단계로 돈다. 제목·요약만 훑으면 **40ms**, 본문까지면 **320ms** (값의 거의 전부가 `content`
TOAST 해제다). 랭킹상 제목·요약 매치가 언제나 본문 매치를 이기므로, 제목·요약만으로 `limit`이
차면 본문을 훑어도 결과가 같다 — 의미를 바꾸지 않는 순수한 절약이다.

`position()`은 LIKE 패턴이 아니라 `%`/`_`/`\` 이스케이프가 아예 필요 없다. 태그드 템플릿
바인드 파라미터만 쓰고 `$queryRawUnsafe`는 쓰지 않는다.

인덱스는 20만 행을 넘고 3자 이상 질의가 로그로 확인될 때 `title` 한 컬럼에만 건다.
`content`엔 걸지 않는다 — 재적재마다 재구축되고 인덱스만 30~100MB다.

### 4.3 볼트 CRUD

폴더·문서의 만들기·이름변경·이동·삭제를 화면에 붙였다. API는 이미 다 있었고 버튼이 없었다.
문서 이동만 새 엔드포인트(`POST /api/pages/[slug]/move`)다.

- 이동 UI는 `<select>`. 드래그앤드롭은 안 한다.
- 메뉴는 `position: fixed`. `.sidebar-body`와 `.doc`가 둘 다 `overflow:auto`라
  절대배치로 두면 아래쪽 행에서 잘린다.
- 트리 갱신은 `tick` prop 하나를 dep 배열에 넣는 것. 마운트된 Branch가 저마다 자기 레벨만
  다시 부르고 아무것도 언마운트되지 않아 펼침 상태가 살아남는다.
- `pageType` / `aliases` 편집은 범위 밖. 속성 블록은 읽기 전용이다.

### 4.4 탭

`localStorage`에 산다. React 상태가 아니다 — §3의 제약 때문에 컴포넌트 상태로는 탭이 한 번도
살아남지 못한다. 최대 8개, 이미 있는 문서는 제목만 갱신해 자리를 지킨다.

### 4.5 경로 재계산 폭탄 제거

`recomputePagePaths`가 페이지마다 `update`를 순차로 돌고 있었다. 온톨로지는 소스당 폴더 하나에
수만 건을 넣으므로, **폴더 이름 한 번 바꾸면 7만 번 왕복**했다.

한 문장 `UPDATE`로 바꿨다. 다만 실측하니 72,186행에 **45.6초**다 — 왕복 때문이 아니라 행 재기록
자체가 값이다(대부분 문서가 2KB 미만이라 인라인 저장되어 통째로 다시 쓰인다). 인덱스 탓이
아님도 확인했다(`wikiPath`를 빼고 돌려도 44.6초).

그래서 더 중요한 수정은 **재계산을 언제 도는가**였다. `PATCH /api/folders/[id]`가 `sortOrder`만
바뀌어도 이걸 돌고 있었다. 이름이나 부모가 **실제로** 바뀐 경우에만 돌게 막았다: 45초 → 0.14초.

진짜 이름 변경 45초는 이 스키마에서 바닥값이다. 줄이려면 `wikiPath`/`depth` 컬럼을 없애야 하고,
그건 마이그레이션이라 v2 범위 밖이다.

## 5. 정리한 것

- `components/ui/ThemeToggle.tsx` 삭제 (import 0건, 캔버스 시절 잔재)
- `d3-force`, `@types/d3-force` 삭제 (import 0건)
- `.diff` / `.add` / `.del` CSS **추가** — 쓰이는데 규칙이 없어 저장 충돌 diff와 리비전 diff가
  색 없는 맨 텍스트로 나오고 있었다
- `/wiki` 맨몸이 404이던 것을 `/`로 리다이렉트

## 6. 범위 밖 (v2에서도)

인증·멀티테넌트·문서 업로드/파싱/청킹/임베딩·벡터검색·RAG 채팅·Fuseki 쓰기·WYSIWYG·
그래프 뷰·드래그앤드롭·`pageType`/`aliases` 편집·E2E 테스트.

채팅/에이전트(툴 8종)는 잘 돌아가므로 v2에서 손대지 않았다.

## 7. 테스트

`vitest run`. 12파일 107건. DB를 쓰는 테스트는 `.env.test`의 별도 DB를 통째로 비우므로
개발 DB를 가리키면 안 된다.

순수 모듈(`links` `slug` `render` `diff` `ontology/build`)과 DB 모듈(`save` `rename` `tree`
`linkify`)에 붙어 있다. Route Handler와 컴포넌트에는 테스트가 없다.
