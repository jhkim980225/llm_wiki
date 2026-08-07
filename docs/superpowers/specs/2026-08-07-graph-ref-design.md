# GraphRef — 개체 참조 · 문서 승격 · 개체 그래프 뷰

2026-08-07 작성. 승인 완료.

대화 결과에 나온 개체(사람·조직·문서)를 본문에서 클릭하면, 그래프 DB에서 끌어와
위키 문서로 만들고, 그 개체 중심의 관계 그래프를 보여준다.

## 배경

`/chat`·WBS 주간일정이 쓰는 소스 RAG API(`lib/rag/source-rag.ts`)는 지금 자연어
`answer`만 준다. 저쪽 팀이 여기에 `entities`(개체명 + 타입)를 추가해줄 예정이며,
스펙 합의 중이다. **이 스펙은 그 필드가 아직 없다는 전제로 쓴다** — 수동 시딩으로
끝단을 먼저 연결하고, 필드가 오면 수집 경로만 갈아끼운다.

요청당 개체는 1건으로 잡혀 있다(현재 합의).

## 이름

테이블명은 `GraphRef`("그래프 참조"). `Entity`를 피한 이유는 `Page.pageType = 'entity'`가
이미 온톨로지 적재본을 뜻해서다 — 같은 낱말이 두 가지를 가리키면 코드가 흐려진다.

`GraphRef`는 개체 자체가 아니라 **그래프에 있는 개체를 가리키는 우리 쪽 포인터 +
조회 레시피 + 문서 승격 상태**다. 이름이 그 정체를 말한다.

## 왜 별도 테이블인가

Page에 얹지 않는 이유 셋:

1. **"아직 문서 아님"이 1급 상태여야 한다.** 대화마다 나온 개체를 전부 Page로 만들면
   빈 껍데기가 트리·검색·그래프를 오염시킨다. GraphRef는 가볍게 쌓고, 사람이 클릭한
   것만 Page로 승격한다.
2. **`sparql`이 Page에 살 자리가 없다.** Page는 편집·버전 대상이고 `version`은 가시
   필드가 바뀔 때만 오른다. 장부성 데이터인 SPARQL을 섞으면 그 규칙이 흐려진다.
3. **재적재 prune과 무관해진다.** `importSource`는 이번 결과에 없는 `ontology` 문서를
   휴지통으로 보낸다(`lib/ontology/import.ts`). 대화에서 나온 개체가 휩쓸리면 안 된다.

## 데이터 모델

```prisma
// 그래프 DB에 있는 개체를 가리키는 참조. 개체 자체가 아니라 포인터 + 조회 레시피다.
// 문서로 승격되기 전에도 [[링크]]가 걸릴 수 있도록 pageSlug를 미리 예약해 둔다.
model GraphRef {
  id         String    @id @default(uuid())
  name       String    // 표시명. "정아라"
  type       String    // 저쪽 API가 주는 타입 값 그대로. "person" 등
  sourceId   String    // OntologySource.id — "ejkim"
  uri        String?   // 그래프 subject URI. 없으면 라벨로 조회한다
  sparql     String    @default("") // 이 개체 이웃 조회 쿼리. 비면 템플릿으로 생성
  pageSlug   String    // "ejkim/정아라" — entitySlug와 같은 규칙으로 미리 예약
  promoted   Boolean   @default(false) // 문서로 승격됐나
  lastSeenAt DateTime  @default(now())
  createdAt  DateTime  @default(now())

  @@unique([sourceId, name])
  @@index([name])
  @@index([pageSlug])
}
```

`pageSlug`를 **미리 확정**하는 것이 설계의 축이다. `entitySlug(source, label, uri)`
(`lib/ontology/build.ts:25`)와 같은 규칙으로 만든다. 문서가 없는 상태에서도
`[[ejkim/정아라]]`를 걸 수 있어야 새 링크 문법이 필요 없어진다.

`@@unique([sourceId, name])` — `uri`가 더 정확한 키지만 nullable이라 유니크로 못 쓴다.
같은 개체가 다시 나오면 `lastSeenAt`만 갱신하고 나머지는 덮지 않는다(사람이 승격한
문서를 되돌리지 않기 위해).

## 링크가 걸리는 방식 — 새 문법 없음

```
본문 "정아라"
  → proposeLinks가 Page + GraphRef 둘 다 후보로 봄
  → [[ejkim/정아라]]  (Page는 아직 없음 = 죽은 링크)
  → 클릭
  → missing 화면 (이미 존재: src/app/wiki/[...slug]/page.tsx:136)
  → GraphRef 있음 → "그래프에서 문서 만들기" 버튼
  → 승격
```

`[[@정아라]]` 같은 새 문법을 만들지 않는다. 만들면 `lib/wiki/links.ts` 파서,
`Markdown.tsx` 렌더, `parseOutLinks`, 백링크 동기화까지 전부 손봐야 한다.
죽은 링크 + 기존 missing 화면 분기로 같은 결과를 얻는다.

**자동 생성하지 않는다.** 죽은 링크 클릭이 곧 문서 생성이 되면 링크만 밟아도 문서가
불어난다. 버튼을 한 번 더 누르게 한다.

### proposeLinks 변경

`lib/pages/linkify.ts:43`의 후보 조회에 GraphRef를 UNION으로 더한다.

- Page와 GraphRef가 같은 이름이면 **Page 우선** (적재본이 이미 있으면 그쪽이 본체)
- 기존 동명이인 규칙(`linkify.ts:53-56` — 좁혀지지 않으면 안 건다)은 그대로 적용
- `MIN_TITLE_LENGTH`·`MAX_CANDIDATES` 제약도 그대로

## 모듈 구조

핵심 로직은 I/O 없는 순수 함수로 두고 Route Handler가 호출한다(리포 규칙).

| 파일 | 역할 | 테스트 |
|---|---|---|
| `lib/graph-ref/sparql.ts` | 타입별 쿼리 템플릿 생성 + **검증** | 순수 · 필수 |
| `lib/graph-ref/graph.ts` | SPARQL 바인딩 → `{nodes, edges}` | 순수 · 필수 |
| `lib/graph-ref/content.ts` | 이웃 목록 → 마크다운 본문 | 순수 · 필수 |
| `lib/graph-ref/store.ts` | Prisma upsert · 승격 | DB |
| `lib/ontology/fetch.ts` | `query()` export 추가 (현재 모듈 내부 전용) | 기존 |

### sparql.ts — 검증이 왜 순수 모듈인가

저쪽 API가 붙는 순간 `sparql`은 **외부 입력**이 된다. LLM이 만든 쿼리를 그대로
Fuseki에 던지면 `DELETE`/`DROP`이 섞일 수 있다. 신뢰 경계이므로 테스트가 붙는다.

```
assertReadOnly(sparql):
  - 주석·PREFIX 제거 후 첫 키워드가 SELECT | CONSTRUCT | ASK | DESCRIBE 여야 함
  - INSERT · DELETE · DROP · CLEAR · LOAD · CREATE · ADD · MOVE · COPY 포함 시 거부
  - 세미콜론으로 이어붙인 다중 구문 거부
  - LIMIT 없으면 부착, 상한(200) 초과면 낮춤
```

거부는 예외를 던진다. Route Handler가 400으로 바꾼다.

### 쿼리 템플릿

이웃 1홉(양방향). named graph 처리는 `fetch.ts:11`의 `anyGraph`와 같은 규칙을 쓴다.

```sparql
SELECT ?rel ?other ?otherLabel ?dir WHERE {
  {
    { <URI> ?rel ?other } UNION { GRAPH ?g { <URI> ?rel ?other } }
    BIND("out" AS ?dir)
    OPTIONAL { { ?other <labelPredicate> ?otherLabel }
               UNION { GRAPH ?g2 { ?other <labelPredicate> ?otherLabel } } }
  } UNION {
    { ?other ?rel <URI> } UNION { GRAPH ?g { ?other ?rel <URI> } }
    BIND("in" AS ?dir)
    OPTIONAL { { ?other <labelPredicate> ?otherLabel }
               UNION { GRAPH ?g2 { ?other <labelPredicate> ?otherLabel } } }
  }
} LIMIT 200
```

`relationNamespace`로 시작하는 술어는 **관계**(에지), 아니면 **속성**(표로 표시).
`lib/ontology/build.ts`가 이미 쓰는 구분 기준을 그대로 따른다.

타입별 분기는 **지금 넣지 않는다.** person/company/document가 실제로 다른 쿼리를
필요로 하는지 확인되지 않았고, 저쪽 타입 값 목록도 아직 없다. 템플릿 하나로 시작하고
필요가 확인되면 `type`으로 가른다.

### URI 해석

`uri`가 비면 라벨로 조회한다.

```sparql
SELECT ?s WHERE { ?s <labelPredicate> "정아라" } ORDER BY ?s LIMIT 5
```

- 1건 → 그걸 쓰고 `GraphRef.uri`에 채워 넣는다(다음부터 조회 생략)
- 여러 건 → `ORDER BY ?s`로 결정적인 첫 건을 쓰되, 승격된 문서 상단에
  "동명 후보 N건" 경고를 남긴다. 조용히 틀린 개체를 보여주지 않기 위해서다
- 0건 → 승격 실패. missing 화면에 "그래프에서 찾지 못했습니다"

## API

| 엔드포인트 | 하는 일 |
|---|---|
| `POST /api/graph-ref` | upsert. 시딩·저쪽 API 응답 수신 |
| `GET /api/graph-ref?name=…` | 조회 (missing 화면이 분기 판정에 쓴다) |
| `POST /api/graph-ref/promote` | `{name}` → 그래프 조회 → Page 생성 → `promoted=true` |
| `GET /api/graph-ref/graph?name=…` | sparql 실행 → `{nodes, edges}` |

전부 `requireSession()`을 거친다(기존 라우트와 같음).

승격으로 만들어지는 Page:

```
pageType       = 'entity'
lastEditSource = 'agent'    ← 'ontology' 아님
folderId       = 소스 폴더 (ensureFolder와 같은 것)
```

`'ontology'`가 아닌 이유는 재적재 prune에 휩쓸리지 않기 위해서다(위 §왜 별도 테이블인가).
`'agent'`라서 재적재가 이 문서를 덮지도 않는다 — 사람이 고친 문서와 같은 보호를 받는다.

## 그래프 뷰

`GraphView`(`components/graph/GraphView.tsx`)를 재사용하지 **않는다**. 그쪽은
`/api/graph` 전량 fetch에 묶여 있고 인스펙터·툴바가 문서 그래프 전제다. 억지로
끼우면 양쪽이 지저분해진다.

공유하는 것은 순수 레이아웃 함수 `layoutGraph`(`lib/wiki/graph.ts`) 하나다.

- 문서 상단에 `[그래프]` 토글. 누르면 본문 자리에 SVG
- 중심 노드 = 이 개체, 이웃 = 1홉
- 노드 클릭 → 그 개체도 GraphRef에 있으면 그 문서로 이동
- 줌·팬은 기존 GraphView와 같은 방식(휠 `passive:false`, 배경 드래그)

## 시딩

```
name: "정아라", type: "person", sourceId: "ejkim"
pageSlug: "ejkim/정아라"
uri: (비움 — 라벨 조회로 해석)
```

**`ejkim` 또는 `seunghoon`으로 넣는다.** kakao는 개발 PC(VPN)에서 Fuseki 접근이
막혀 있어 로컬 확인이 불가능하다(`lib/ontology/source.ts:32-39`).

정규 경로는 `POST /api/graph-ref`다 — 서버가 `entitySlug`로 `pageSlug`를 계산하므로
slug 규칙이 한 군데에만 산다.

별도 시딩 스크립트는 만들지 않았다. `@/` 경로 별칭 때문에 순수 node 스크립트가
`entitySlug`를 못 불러오고, 규칙을 복사하면 두 벌이 되어 언젠가 어긋난다. 최초 1건은
SQL로 직접 넣었고(`ON CONFLICT DO NOTHING`), 이후는 API를 쓴다. 관리 화면도 만들지
않는다 — 소스 API가 붙으면 안 쓰게 된다.

## 확인 경로

```
1. 시딩 실행
2. 아무 문서에 "정아라" 써넣고 저장
3. [링크 제안] → [[ejkim/정아라]] 걸림
4. 클릭 → "문서가 없습니다 · 그래프에서 문서 만들기"
5. 누름 → 문서 생성 (속성 표 + 관계 목록)
6. [그래프] → 정아라 중심 관계도
```

## 범위 밖 (지금 넣지 않는 것)

| 항목 | 넣는 시점 |
|---|---|
| 그래프 결과 캐시 | 조회가 느리다고 실측되면 |
| entity 자동 수집 | 저쪽 API에 `entities` 필드가 붙으면 |
| 타입별 쿼리 분기 | 타입 값 목록을 받고 실제 차이가 확인되면 |
| GraphRef 관리 UI | 시딩 스크립트로 충분 |
| 2홉 이상 그래프 | 1홉으로 부족하다는 요구가 나오면 |
| 역반영(위키 → Fuseki) | `docs/db-roles.md` §6 장기 과제 |

## 열린 항목

- 저쪽 API의 `type` 값 목록 미정 — 받으면 화면 표시(아이콘·색)를 타입별로 가른다
- `uri` 제공 여부 미정 — 오면 라벨 조회 단계를 건너뛴다. 안 와도 동작한다
