> **대체됨 — `2026-08-04-wiki-v2-design.md`를 보라.** 이 문서가 중심에 둔 "두 레이어 그래프 뷰"는
> 구현 도중 폐기됐다. 온톨로지는 그래프로 그리지 않고 위키 문서로 물질화하며(`7bbd4f4`),
> 그래프 뷰 코드는 전부 삭제됐다(`70a9604`). 설계 이력으로만 남긴다.

# 위키 + 그래프 독립 프로젝트 설계

2026-08-03 · 원본: `C:\feda\llm_wiki\weknora` (WeKnora 포크, `feature/fuseki-graph-engine`)

## 1. 목적

llm_wiki에서 **위키**와 **옵시디언식 그래프 뷰**만 떼어내 독립 앱으로 재작성한다.
그래프는 두 레이어를 토글로 겹쳐 본다: 위키 링크 그래프(자체 DB) + 외부 Fuseki 지식 그래프(SPARQL 읽기).

원본은 문서 인제스트·RAG 채팅·멀티테넌트가 위키에 얽혀 있어 코드 이식이 아니라 **명세 이식**으로 간다.

## 2. 확정된 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 스택 | Next.js 15 App Router + TypeScript + React 19 | 사용자 지정. Route Handler를 API로 써서 서버 프로세스 1개 |
| DB | PostgreSQL + Prisma | 위키 페이지·리비전은 관계형. Prisma는 마이그레이션 포함이라 별도 도구 불필요 |
| 인증 | v1 없음 | 단일 워크스페이스. 원본의 tenant/KB 스코프는 전부 제거 |
| 그래프 물리 | `d3-force` + 자체 canvas 렌더러 | 원본은 force 시뮬레이션을 손으로 구현(WikiBrowser.vue 약 500줄). 검증된 라이브러리로 대체하고 렌더링만 직접 |
| Fuseki | 읽기 전용 SPARQL 클라이언트 (fetch, 무의존성) | 원본 `fuseki/repository.go` 354줄이 stdlib만 씀 — TS 이식 쉬움. 쓰기는 외부 시스템 담당 |
| LLM | Vercel AI SDK + openai-compatible provider → 사내 Ollama | 원본과 동일 엔드포인트(`http://192.168.0.152:11434`, `qwen3:14b`) 재사용 |
| 에디터 | markdown textarea + `marked`+`dompurify` 프리뷰 | v1은 편집 기능이 목적. WYSIWYG는 나중 |

### 범위 밖 (원본에서 의도적으로 안 가져옴)

문서 업로드·파싱·청킹·임베딩·벡터검색·asynq 큐·docreader·RAG 채팅·멀티테넌트·KB 개념·위키 lint/issue 파이프라인·Fuseki 쓰기 경로.

## 3. 데이터 모델

### `Page`

원본 `types.WikiPage`에서 tenant/KB/청크 참조를 걷어낸 형태.

| 필드 | 타입 | 비고 |
|---|---|---|
| `id` | uuid | |
| `slug` | string unique | 주소. `entity/acme-corp` 처럼 `/` 포함 가능 |
| `title` | string | |
| `pageType` | enum | `summary` `entity` `concept` `index` `synthesis` `comparison` |
| `status` | enum | `draft` `published` `archived` |
| `content` | text | 마크다운 |
| `summary` | text | 한 줄 요약 |
| `aliases` | string[] | 별칭·약어. 링크 주입과 Fuseki 매칭에 쓰임 |
| `folderId` | uuid? | 트리 위치의 단일 진실. `null` = 루트 |
| `categoryPath` | string[] | folder 체인 캐시 (쓰기마다 재계산) |
| `wikiPath` | string | 정렬용 정규화 경로 캐시 |
| `depth` | int | `categoryPath.length` 캐시 |
| `sortOrder` | int | 형제 정렬 |
| `inLinks` | string[] | 백링크 slug |
| `outLinks` | string[] | 아웃링크 slug |
| `metadata` | json | 태그 등 |
| `version` | int | **사용자 가시 필드(title/content/summary/pageType/status)가 실제로 바뀔 때만** 증가. 링크 유지보수 같은 장부성 쓰기는 건드리지 않음 |
| `lastEditSource` | enum | `user` `agent` `revert` |
| `createdAt` `updatedAt` `deletedAt` | | soft delete |

### `PageRevision`

교체된 버전의 불변 스냅샷. `(pageId, version)` 유니크. 편집 트랜잭션 안에서 편집 **전** 상태를 삽입한다. 필드: `pageId` `slug` `version` `title` `content` `summary` `pageType` `status` `editSource` `editorId` `createdAt`.

### `Folder`

`id` `parentId` `name` `sortOrder`. 순환 방지 검증 필수.

## 4. 컴포넌트

세 계층이 서로 독립적으로 테스트 가능해야 한다.

### 4.1 `lib/wiki/links.ts` — 링크 파서 (순수 함수)

원본 `wiki_linkify.go` 565줄의 핵심 규칙을 이식한다.

- `parseOutLinks(content)` — `[[slug]]` / `[[slug|표시명]]` 추출. 정규식 `\[\[([^\]]+)\]\]`, `|` 앞이 slug
- `computeForbiddenSpans(content)` — 링크를 **주입하면 안 되는** 범위. 펜스 코드블록(``` / ~~~), 인라인 코드, 기존 `[[...]]`, 마크다운 링크 `[t](u)`, 이미지 `![a](u)`, 참조링크 `[t][l]`, 참조정의 `[l]: url`, 자동링크 `<url>`
- `linkifyContent(content, refs, selfSlug)` — 각 ref의 **첫 번째** 안전한 출현만 `[[slug|표시명]]`으로 감쌈. 이미 그 slug로 링크된 ref, 자기 자신 ref는 건너뜀
- 단어 경계: matchText가 ASCII 문자/숫자로 시작하거나 끝날 때만 경계 검사. CJK는 경계 개념이 없어 검사 안 함 (`북경`이 `북경대학교` 안에서도 매치됨 — 길이 내림차순 정렬로 충돌 처리)
- `rewriteDeadWikiLinks(content, oldSlug, newSlug)` — 페이지 rename 시 전체 페이지의 참조 재작성

**이식 시 함정**: 원본은 Go 바이트 오프셋 기반. TS는 UTF-16 코드유닛이라 한글/이모지에서 오프셋이 다르다. span 계산과 치환을 전부 JS 문자열 인덱스로 일관되게 다시 짜고, 한글 문자열 테스트를 반드시 넣는다.

### 4.2 `lib/graph/subset.ts` — 그래프 계산 (순수 함수)

원본 `computeGraphSubset`(wiki_page.go:592) 이식. I/O 없음.

입력: 전체 페이지 배열 + `{mode, center, depth, types[], limit}`
출력: `{nodes[], edges[], meta}`

- `overview` 모드: 타입 필터 통과 후보를 `linkCount` 내림차순 정렬, 동점은 slug 오름차순(결정적), `limit`으로 절단
- `ego` 모드: `center`에서 BFS `depth`단계. 타입 필터는 **후보 선별에만** 적용되고 탐색 경로는 막지 않음
- `linkCount = inLinks.length + outLinks.length`
- 엣지: 양쪽 끝이 모두 선택 집합에 남은 것만
- `meta.total`은 절단 전 후보 수 — overview는 필터 반영, ego는 전체 페이지 수. 프론트가 "X of Y" 힌트와 확장 UI를 결정하는 근거
- API 상한: `limit` 기본 500 / 최대 2000, `depth` 기본 1 / 최대 3

### 4.3 `lib/fuseki/client.ts` — SPARQL 읽기 클라이언트

원본 `fuseki/repository.go` 이식, 읽기만. 의존성 없이 `fetch`.

- `query(sparql)` — POST `application/sparql-query`, Accept `application/sparql-results+json`, Basic 인증
- `searchNodes(labels[], namespace?)` — 라벨 CONTAINS 매칭으로 개체·관계 서브그래프 반환
- `nodeProps(uri)` — 노드 속성 조회
- 트리플 규약 (원본 그대로): `rdfs:label` = 표시명, `urn:weknora:prop:attr` = 속성, `urn:weknora:prop:chunk` = 출처 청크 ID(새 앱에선 표시만), `urn:weknora:rel:{관계명}` = 엣지
- **리터럴 이스케이프 필수** — 사용자 입력이 SPARQL 문자열에 들어가므로 `\`, `"`, 개행을 이스케이프한다. 원본 `escapeLiteral` 동작 유지
- 실패는 앱을 멈추지 않는다. Fuseki가 죽어도 위키 레이어는 정상 동작하고 그래프 UI에 "Fuseki 레이어 사용 불가"만 뜬다

### 4.4 그래프 뷰 (두 레이어)

canvas 하나에 레이어 두 개를 겹친다. 각각 독립 토글.

| | 위키 링크 레이어 | Fuseki 개체 레이어 |
|---|---|---|
| 노드 | 페이지 (slug) | 개체 (IRI) |
| 색 | pageType별 | 관계 타입별 |
| 소스 | `GET /api/graph` | `GET /api/graph/entities` |

**레이어 간 노드 매칭 규칙**: 페이지의 `title` 또는 `aliases` 중 하나를 정규화(트림·소문자·공백단일화)한 값이 Fuseki 노드의 `rdfs:label` 정규화 값과 **완전 일치**할 때 같은 개념으로 본다. 매칭되면 두 노드를 점선으로 잇고, 둘 다 표시 중이면 서로 하이라이트한다. 부분일치·임베딩 유사도는 v1 범위 밖(오탐이 그래프를 못 쓰게 만든다).

인터랙션: 검색 후 포커스, 노드 클릭 시 페이지 열기, ego 모드 프론티어 확장, fit-to-view, 타입별 범례 토글.

### 4.5 에이전트 툴

AI SDK 툴로 노출. 각 툴은 4.1~4.3 계층을 호출할 뿐 자체 로직을 갖지 않는다.

`wiki_search` · `wiki_read_page` · `wiki_write_page` · `wiki_replace_text` · `wiki_rename_page` · `wiki_delete_page` · `wiki_link_mutation` · `query_knowledge_graph`(Fuseki)

에이전트 쓰기는 `lastEditSource = "agent"`로 기록돼 리비전 히스토리에서 사람 편집과 구분된다.

**읽기 예산**: `wiki_read_page`는 긴 페이지를 통째로 넣지 않는다. 원본과 동일하게 문자 예산을 두고 초과분은 잘라내며 잘렸음을 명시한다.

## 5. 데이터 흐름 — 페이지 저장

```
PUT /api/pages/[slug]
  → 낙관적 잠금 확인 (요청 version vs 현재 version, 불일치면 409)
  → 트랜잭션 시작
      → 편집 전 상태를 PageRevision에 삽입
      → outLinks = parseOutLinks(새 content)
      → 대상 페이지들의 inLinks 갱신 (추가분/제거분만)
      → categoryPath·wikiPath·depth 재계산
      → 가시 필드가 바뀌었으면 version++
  → 커밋
```

rename은 여기에 더해 전체 페이지의 `[[oldSlug]]` 참조를 `rewriteDeadWikiLinks`로 재작성한다.

## 6. 에러 처리

- **버전 충돌**: 409 + 현재 서버 버전 반환. UI는 diff를 보여주고 덮어쓰기/병합을 사용자에게 맡긴다
- **Fuseki 다운**: 그래프 API는 위키 레이어만 담아 200을 반환하고 `meta.fusekiError`에 사유를 넣는다. 위키 기능 영향 없음
- **LLM 다운**: 채팅 패널만 실패. 위키·그래프 정상
- **깨진 링크**: 존재하지 않는 slug를 가리키는 `[[링크]]`는 삭제하지 않고 붉게 표시 + "이 이름으로 생성" 버튼 (옵시디언과 동일)
- **폴더 순환**: 이동 시 조상 체인 검사, 위반이면 400

## 7. 테스트

pure 함수 계층이 로직의 대부분이라 여기에 vitest를 집중한다.

- `links.test.ts` — 코드블록 안 미주입, 기존 링크 미중복, 첫 출현만, ASCII 단어경계, **한글 오프셋**, rename 재작성
- `subset.test.ts` — overview 정렬·절단 결정성, ego BFS 깊이, 타입 필터가 탐색을 막지 않음, 고아 엣지 제거, meta.total 의미
- `fuseki.test.ts` — SPARQL 리터럴 이스케이프, 결과 파싱, 연결 실패 시 graceful degradation
- 저장 트랜잭션 — 링크 양방향 갱신, 버전 증가 조건, 409 충돌
- E2E는 v1 범위 밖

## 8. 단계

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| 1 | 스키마 + 페이지 CRUD + 링크 파서 + 리비전 + 브라우저 UI | 페이지 쓰고 `[[링크]]` 걸고 백링크 보이고 되돌리기 동작 |
| 2 | 그래프 API + canvas 뷰 (위키 레이어) | overview/ego 전환, 검색 포커스, 노드 클릭 이동 |
| 3 | Fuseki 클라이언트 + 개체 레이어 + 토글 + 매칭 | 두 레이어 겹쳐 보이고 Fuseki 죽어도 위키 정상 |
| 4 | 에이전트 툴 + 채팅 패널 | LLM이 페이지 편집, 히스토리에 agent로 기록 |

## 9. 환경 변수

```
DATABASE_URL=postgres://...
FUSEKI_URL=http://192.168.0.100:31406
FUSEKI_DATASET=ds
FUSEKI_USER= / FUSEKI_PASSWORD=
LLM_BASE_URL=http://192.168.0.152:11434/v1
LLM_MODEL=qwen3:14b
```

## 10. 사람 없는 동안 내린 판단 (되돌리기 비용 순)

1. **인증 없음** — 되돌리기 쉬움. 나중에 미들웨어 한 겹
2. **KB/테넌트 제거** — 되돌리기 비쌈. 나중에 필요하면 모든 테이블에 컬럼 추가 + 전 쿼리 스코프. 단일 워크스페이스가 요구사항에 맞다고 판단
3. **레이어 매칭을 완전일치로** — 되돌리기 쉬움. 규칙 함수 하나
4. **lint/issue 파이프라인 제외** — LLM 인제스트에 붙어 있던 기능이라 인제스트 없이는 의미 없음
