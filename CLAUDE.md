# GraphWiki (wiki-graph)

사내 Fuseki 온톨로지를 위키 문서로 들여와 옵시디언처럼 `[[링크]]`로 오가며 읽고 고치는 앱.
개체를 그래프로 그리지 않는다 — 개체가 문서 자체다. 현재 용도는 사내 데모/PoC.

## 문서 지도

| 문서 | 내용 |
|---|---|
| `README.md` | 실행·배포·연동 상세 (Fuseki 현황, vLLM, k8s) |
| `docs/design.md` | **UI 디자인 표준** — 화면 작업 전 필독. 어긋나면 문서부터 고친다 |
| `docs/기능정의서.md` | 구현 완료/예정 기능 목록 (격식체, 팀 공유용) |
| `docs/architecture.md` | 시스템 구조도 — Fuseki(원본)·Postgres(작업본) 역할 분담, 데이터 흐름 |
| `docs/db-roles.md` | 그래프 DB vs RDB 역할 상세 — 적재가 필요한 이유, 검색 3경로, Wikidata 선례, FAQ |
| `docs/rag-architecture.md` | RAG 파이프라인 구조 — 검색 3갈래·예산·생성 규칙·확장 로드맵 |
| `docs/소스-rag-api.md` | 소스 RAG API 3개 실측 — 응답 형태·type 값·개체 필터·소요시간. `scripts/probe-rag-api.mjs`로 재현 |
| `docs/superpowers/specs/2026-08-04-wiki-v2-design.md` | v2 설계 결정 기록 |
| `docs/서버정보.md` | **배포·SSH 전 필독** — 클러스터 접속 계정·비밀번호(FEDA_PW), 스토리지클래스. git 미포함 |
| `docs/manual/사용자-매뉴얼.md` | 최종 사용자 매뉴얼 (화면 캡처 포함, PDF 동봉). 화면 바뀌면 캡처·PDF 재생성 |

## 스택 · 명령

- Next.js 16 App Router · React 19 · TypeScript · Prisma + PostgreSQL. **Tailwind 없음** — 순수 CSS + 변수(`globals.css`)
- 아이콘 lucide-react · 폰트 Pretendard Variable(기본) + JetBrains Mono(코드·URI만) · 다크 단일 테마
- 인증 없음, 단일 워크스페이스

```bash
docker compose up -d      # Postgres (호스트 15432)
npm run dev               # 보통 이미 13000에 떠 있음 — 새로 띄우기 전에 확인. basePath 때문에 화면은 /graphwiki 아래
npm test                  # vitest. .env.test의 별도 DB 필수 (통째로 비운다!)
npx tsc --noEmit          # 타입 체크
py deploy/deploy.py 0.x.0 # feda 배포 — 비밀번호는 docs/서버정보.md(gitignore)에서 읽어 FEDA_PW로 넣는다
```

## 아키텍처 규칙

- **핵심 로직은 I/O 없는 순수 함수 모듈**(`lib/wiki/*`, `lib/ontology/build.ts`)로 두고
  Route Handler·컴포넌트가 호출한다. 테스트는 Prisma/Next를 안 거친다
- **저장은 늘 낙관적 잠금**(`expectedVersion` → 어긋나면 409 + diff). 자동 병합 없음
- `version`은 가시 필드(title·content·summary·pageType·status)가 실제로 바뀔 때만 오른다.
  링크 유지보수·이동·경로 재계산 같은 장부성 쓰기는 안 올린다
- `lastEditSource` ∈ user·agent·revert·ontology. **온톨로지 재적재는 `ontology`인 문서만
  갱신** — 사람이 고친 문서를 조용히 덮지 않는다
- soft delete. slug 유니크는 삭제 행에도 걸려서 재사용 시 `createOrRevivePage`가 되살린다
- 내비게이션: 트리·레일은 맨 `<a>` + Vault의 클릭 인터셉터가 `router.push`로 변환.
  본문 위키링크는 `dangerouslySetInnerHTML`이라 PageView의 인터셉터가 같은 일을 한다.
  라우트 전환 fade는 `app/template.tsx`(pathname key) 하나가 담당
- 탭 목록은 localStorage (React 상태 아님)
- 검색은 한국어 부분문자열 + 랭킹. tsvector·pg_trgm 쓰지 않는 이유는 README 참조

## 함정 (실측으로 확인된 것)

- vLLM(qwen3)은 **thinking을 꺼야 한다** (`provider.ts`가 처리). guided decoding 미지원 —
  `generateObject` 금지, `lib/llm/json.ts`로 평문 파싱
- Fuseki 질의 경로는 `/{dataset}/sparql`. `/query`는 405
- 큰 폴더 이름변경 45초 (72k 행 재기록) — 이름·부모가 실제로 바뀔 때만 재계산 돌게 되어 있음
- 소스마다 SPARQL 어휘가 다르다 — 차이는 전부 `lib/ontology/source.ts`에서만 흡수
- `aliases`에 RDF 타입명이 들어 있어 동의어로 쓰면 안 된다 (linkify가 안 보는 이유)
- ejkim 온톨로지는 메일 1건을 여러 노드로 쪼갠다(Email=라벨만·빈 껍데기, BusinessCase=본문,
  RE: 스레드, ·견적 서브케이스). 적재(`buildPages`)가 동명·연결·한쪽만 리터럴인 분신을
  본체로 병합하고, 전량 적재 시 이번 결과에 없는 온톨로지 문서를 휴지통으로 보낸다(prune).
  링크 후보는 여전히 `relatedPagesFor`(lib/rag/compose.ts) 규칙을 거친다
- 개발 PC(VPN)에서 kakao Fuseki 접근 불가 (NetworkPolicy). 클러스터 안에선 됨
- **basePath `/graphwiki`** (cloud.fedaground.com 경로 배포). 라우터·에셋은 Next가 접두사를
  붙이지만 `fetch('/api/…')`는 안 붙인다 — `BasePathFetch`(layout에 장착)가 전역 패치.
  구경로는 next.config의 catch-all 리다이렉트가 받아준다. API 직접 호출은 `/graphwiki/api/…`

## 테스트

`vitest` — 순수 모듈 + DB 모듈 + Route Handler(`src/app/api/__tests__/routes.test.ts`).
**`.env.test`가 가리키는 DB를 통째로 비우므로 개발 DB를 가리키면 절대 안 된다.**
컴포넌트 테스트는 아직 없음.

## 배포 (요약)

레지스트리 없음. `deploy/deploy.py <버전>`이 빌드 → gzip 업로드(worker01) → `ctr import` →
마스터(200)에서 apply → 롤아웃 확인 → 이미지 정리(현재+직전만)까지 전부 한다.
SSH는 패스워드 인증만(paramiko). 상세는 README와 메모리 `feda-deploy-path` 참조.

## 작업 관행

- 화면 작업 전 `docs/design.md` 확인, 결정이 바뀌면 문서에 이력 남기기
- 기능 추가/변경 시 `docs/기능정의서.md` 갱신
- 원격 깃 연결 전 — **커밋/푸시 제안하지 않는다** (사용자 지시)
- 이모지 아이콘 금지, lucide-react만. 색상은 CSS 변수 토큰만
