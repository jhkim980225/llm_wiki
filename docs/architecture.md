# 시스템 구조도

2026-08-06 기준. 저장 구조 논의(그래프 DB 기반 vs RDB)의 결론 반영 —
**Fuseki = 지식의 원본, Postgres = 위키 작업본**, 역반영은 예정.

## 전체 구조

```mermaid
flowchart LR
    subgraph FUSEKI["사내 Fuseki (그래프 DB · 타 팀 운영)"]
        EJ[ejkim<br/>이메일 온톨로지]
        SH[seunghoon<br/>온톨로지]
        KK[kakao<br/>지식그래프]
        DS[(ds<br/>전용 dataset · 비어 있음)]
    end

    subgraph APP["wiki-graph 앱 (Next.js · feda 클러스터)"]
        ING["온톨로지 적재<br/>/sources · lib/ontology"]
        CHAT["도우미 /chat<br/>AI 작성 /ask"]
        UI["화면<br/>문서 트리 · 문서 상세 · 그래프 뷰 · 검색"]
        API["Route Handlers<br/>/api/*"]
    end

    subgraph PG["Postgres (작업본 · 221 MB)"]
        PAGE[("Page 12만 행<br/>slug · content · outLinks/inLinks<br/>embedding(pgvector)")]
        REV[("PageRevision<br/>수정 이력")]
        FOLD[("Folder<br/>트리")]
    end

    LLM["사내 vLLM (qwen3)"]

    EJ & SH & KK -- "SPARQL 조회<br/>(개체→문서, 관계→[[링크]])" --> ING
    ING -- "스냅샷 저장<br/>lastEditSource=ontology" --> PAGE

    EJ & SH & KK -. "실시간 SPARQL<br/>(건수·근거 질의)" .-> CHAT
    CHAT --- LLM
    CHAT -- "생성 문서 저장<br/>(agent)" --> API

    UI --- API
    API -- "CRUD · 검색 · 그래프 데이터" --> PAGE
    API --> REV & FOLD

    API -. "역반영 (예정)<br/>문서·링크를 트리플로" .-> DS
```

## 데이터 흐름 요약

| 흐름 | 경로 | 시점 |
|---|---|---|
| 온톨로지 적재 | Fuseki → Postgres `Page` | 수동 (/sources). 사람이 고친 문서는 안 덮음 |
| 실시간 그래프 질의 | /chat·/ask → Fuseki SPARQL 직행 | 매 질문. Postgres 안 거침 |
| 문서 편집·검색·그래프 뷰 | 화면 → /api/* → Postgres | 매 요청. Fuseki 안 거침 |
| AI 문서 저장 | /ask·/chat → `Page` (editSource=agent) | 저장 시 `[[링크]]` 파싱 → outLinks/inLinks 동기화 |
| 역반영 | Postgres → 전용 dataset `ds` | **미구현 (다음 단계)** — 이걸로 "그래프=진실" 완성 |

## 역할 분담 원칙

- **Fuseki (그래프 DB)** — 지식의 원본. 개체·관계. 관계 질의(SPARQL)와 타 팀 연동.
  타 팀 인프라라 읽기 전용, 우리 쓰기는 전용 dataset(`ds`)에만 (예정).
- **Postgres (RDB)** — 위키 작업본. 그래프 DB가 못 하는 것 전담:
  마크다운 본문 저장, 리비전·낙관적 잠금·휴지통, 한국어 부분문자열 검색,
  pgvector 의미검색, 트리 페이징. 그래프에서 재구축 가능한 파생물로 취급.
- **그래프 뷰(/graph)** — Fuseki가 아니라 `Page.outLinks`에서 계산.
  문서 트리와 같은 기준(적재본 제외), 연결 상위 200개만 렌더.

## 관련 문서

- 그래프 DB vs RDB 역할 상세(적재 이유·검색 경로·FAQ): `docs/db-roles.md`
- 실행·배포·Fuseki 현황: `README.md`
- RAG 파이프라인(/ask 내부): `docs/rag-architecture.md`
- UI 표준: `docs/design.md`
- 기능 목록: `docs/기능정의서.md`
