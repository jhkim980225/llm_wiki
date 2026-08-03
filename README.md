# Wiki Graph

llm_wiki에서 **위키**와 **옵시디언식 그래프 뷰**만 떼어낸 독립 앱. 외부 Fuseki 지식 그래프를 두 번째 레이어로 겹쳐 본다.

설계: `docs/superpowers/specs/2026-08-03-wiki-graph-standalone-design.md`
구현 계획: `docs/superpowers/plans/2026-08-03-wiki-graph-standalone.md`

## 띄우기

```bash
docker compose up -d          # Postgres (호스트 포트 15432)
cp .env.example .env
npx prisma migrate dev
npm run dev                   # http://localhost:3000
```

화면: `/graph` 그래프 · `/wiki/<slug>` 페이지 · `/chat` 위키 편집 도우미

## 테스트

```bash
docker exec <db컨테이너> createdb -U wiki wiki_test
printf 'DATABASE_URL=postgres://wiki:wiki@localhost:15432/wiki_test\n' > .env.test
DATABASE_URL=postgres://wiki:wiki@localhost:15432/wiki_test npx prisma migrate deploy
npm test
```

테스트는 `.env.test`의 별도 DB를 쓴다. 테이블을 통째로 비우므로 개발 DB를 가리키면 안 된다.

## 구조

| 경로 | 역할 |
|---|---|
| `src/lib/wiki/links.ts` | `[[링크]]` 파싱·주입·rename 재작성 (순수 함수) |
| `src/lib/wiki/render.ts` | 위키링크 → 앵커 변환 (XSS 이스케이프 포함) |
| `src/lib/wiki/diff.ts` | 줄 단위 LCS diff |
| `src/lib/graph/subset.ts` | overview/ego 서브그래프 계산 (순수 함수) |
| `src/lib/graph/match.ts` | 위키 노드 ↔ Fuseki 노드 이름 매칭 |
| `src/lib/fuseki/client.ts` | SPARQL 읽기 (fetch만, 의존성 없음) |
| `src/lib/pages/save.ts` | 저장 트랜잭션 — 리비전·백링크·낙관적 잠금 |
| `src/lib/llm/provider.ts` | LLM 백엔드 선택 + thinking 끄기 |
| `src/lib/agent/tools.ts` | LLM이 위키를 편집하는 툴 8종 |
| `src/components/graph/` | d3-force 물리 + 자체 canvas 렌더러 |

로직의 핵심은 I/O 없는 순수 함수라 Route Handler와 컴포넌트를 거치지 않고 바로 테스트한다.

## LLM 백엔드

기본은 사내 **vLLM** (`qwen3-32b-finance`, `http://192.168.10.7/v1`, 인증 없음, OpenAI 호환).

```
LLM_BACKEND=vllm            # vllm(기본) | ollama
LLM_BASE_URL=http://192.168.10.7/v1
LLM_MODEL=qwen3-32b-finance
```

- **thinking은 반드시 꺼야 한다.** qwen3는 답변 앞에 사고 과정을 수천 토큰 뱉는다. 켜두면 호출당 3~10배 느려진다(실측: on 817~4,650 토큰 / off 202~486). `src/lib/llm/provider.ts`가 `chat_template_kwargs.enable_thinking=false`를 요청 body에 실어 보낸다 — 목 서버로 실제 body를 확인하는 테스트가 있다
- **컨텍스트 32,768 토큰.** 에이전트 페이지 읽기 상한(`READ_BUDGET`)이 이 안에 들어오게 잡혀 있다
- **동시 호출은 사실상 공짜.** GB10은 메모리 대역폭 병목이라 8건 동시 실행이 단일 실행과 같은 시간에 끝난다(실측 8.1배 처리량). 호출을 묶지 말고 작은 호출을 여러 개 던지는 편이 빠르다
- **vLLM이 죽으면** `LLM_BACKEND=ollama`로 바꾸면 `qwen3:14b`(`192.168.0.152`)로 넘어간다. 재빌드 불필요
- `GET /api/llm`이 현재 백엔드·연결·모델 존재 여부를 알려준다. 채팅 화면 우상단 배지가 이 값을 보여준다

출처: `C:\feda\llm_wiki\docs\vLLM-연동.md`

## 알아둘 것

- **낙관적 잠금**: 저장은 `expectedVersion`을 함께 보낸다. 어긋나면 409 + 서버 버전. 자동 병합하지 않고 사용자가 diff를 보고 결정한다
- **version 증가 조건**: title·content·summary·pageType·status가 실제로 바뀔 때만. 링크 유지보수 같은 장부성 쓰기는 건드리지 않아 "편집됨" 신호가 오염되지 않는다
- **Fuseki 장애**: 그래프 API는 위키 레이어만 담아 200을 돌려주고 `error`에 사유를 넣는다. 위키는 정상 동작한다
- **레이어 매칭**: 페이지 title/alias와 Fuseki `rdfs:label`이 정규화 후 **완전히** 같을 때만 잇는다. 부분일치는 오탐이 많아 뺐다 (`src/lib/graph/match.ts`에서만 바꾸면 됨)
- **Fuseki 질의 경로**는 `/{dataset}/sparql`이다. `/query`는 405를 준다

## 범위 밖 (v1)

인증·멀티테넌트·문서 업로드/파싱/청킹/임베딩·벡터검색·RAG 채팅·Fuseki 쓰기.
