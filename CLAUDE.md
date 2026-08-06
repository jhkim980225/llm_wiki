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
| `docs/superpowers/specs/2026-08-04-wiki-v2-design.md` | v2 설계 결정 기록 |

## 스택 · 명령

- Next.js 16 App Router · React 19 · TypeScript · Prisma + PostgreSQL. **Tailwind 없음** — 순수 CSS + 변수(`globals.css`)
- 아이콘 lucide-react · 폰트 Pretendard Variable(기본) + JetBrains Mono(코드·URI만) · 다크 단일 테마
- 인증 없음, 단일 워크스페이스

```bash
docker compose up -d      # Postgres (호스트 15432)
npm run dev               # 보통 이미 13000에 떠 있음 — 새로 띄우기 전에 확인
npm test                  # vitest. .env.test의 별도 DB 필수 (통째로 비운다!)
npx tsc --noEmit          # 타입 체크
py deploy/deploy.py 0.x.0 # feda 배포 (FEDA_PW 환경변수 필요) — README 참조
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
- 개발 PC(VPN)에서 kakao Fuseki 접근 불가 (NetworkPolicy). 클러스터 안에선 됨

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
