# Wiki Graph

llm_wiki에서 **위키**만 떼어낸 독립 앱. 외부 Fuseki 온톨로지를 그래프로 그리지 않고 **문서로 들여** 옵시디언처럼 `[[링크]]`로 잇는다.

설계: `docs/superpowers/specs/2026-08-03-wiki-graph-standalone-design.md`
구현 계획: `docs/superpowers/plans/2026-08-03-wiki-graph-standalone.md`

## 띄우기

```bash
docker compose up -d          # Postgres (호스트 포트 15432)
cp .env.example .env
npx prisma migrate dev
npm run dev                   # http://localhost:3000
```

화면: `/wiki` 들머리 · `/wiki/<slug>` 문서 · `/sources` 온톨로지 적재 · `/graph` 연결 보기 · `/chat` 도우미

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
| `src/lib/fuseki/client.ts` | SPARQL 읽기 (fetch만, 의존성 없음) |
| `src/lib/ontology/source.ts` | 온톨로지 소스 목록 (어휘 차이를 여기서 흡수) |
| `src/lib/ontology/build.ts` | 개체·트리플 → 위키 문서 변환 (순수 함수) |
| `src/lib/ontology/import.ts` | 대량 적재 (수만 건 배치 upsert) |
| `src/lib/pages/save.ts` | 저장 트랜잭션 — 리비전·백링크·낙관적 잠금 |
| `src/lib/llm/provider.ts` | LLM 백엔드 선택 + thinking 끄기 |
| `src/lib/agent/tools.ts` | LLM이 위키를 편집하는 툴 8종 |
| `src/components/graph/` | d3-force 물리 + 자체 canvas 렌더러 |

로직의 핵심은 I/O 없는 순수 함수라 Route Handler와 컴포넌트를 거치지 않고 바로 테스트한다.

## 온톨로지를 문서로 들이기

Fuseki의 개체를 **그래프로 그리는 대신 위키 문서로 만든다.** 개체 하나가 문서 하나가 되고,
개체 사이의 관계는 본문에 `[[링크]]`로 적힌다. 옵시디언처럼 어느 문서에서 시작해도 이웃으로
걸어갈 수 있다.

```
POST /api/ontology  {"source":"seunghoon","limit":40000}
GET  /api/ontology                       # 소스 목록과 적재된 문서 수
```

`/sources` 화면에서 버튼으로도 돌린다. 실측(승훈 온톨로지):

```
개체 24,822 · 트리플 108,089 → 문서 24,822 · 링크 108k · 36초 · 죽은 링크 0
```

- **사람이 손댄 문서는 덮어쓰지 않는다.** `lastEditSource`가 `ontology`인 문서만 갱신하고,
  `user`/`agent`가 편집한 문서는 `skipped`로 센다
- **부분 적재도 이어진다.** `limit`을 걸면 관계 대상이 슬라이스 밖으로 나가는데, 그 대상의
  표시명만 한 번 더 가져와 문서로 만든다(1홉 닫기). 그래서 작은 limit으로도 링크가 살아 있다
- **소스별 폴더·slug 접두사**를 둔다. 소스가 늘어도 같은 이름의 개체가 충돌하지 않는다
- 어휘 차이(관계 네임스페이스, 표시명 술어)는 `src/lib/ontology/source.ts`에서만 다룬다.
  변환 코드는 소스를 구분하지 않는다

### 사내 Fuseki 현황 (2026-08-04)

| 네임스페이스 | NodePort | 데이터셋 | 트리플 | 접근 |
|---|---|---|---|---|
| `seunghoon-ontology` | 30310 | `/ontology` | 165,908 | 열림 |
| `stockwiki` | 31031 | `/ds` | 0 | 열림 |
| `jh-llm-wiki` | 31406 | `/ds` | 0 | 열림 |
| `ejkim-ontology` ×3 | 30303·30306·30301 | `/ontology` | ? | NetworkPolicy 차단 |
| `manager-ontology` | 30308 | `/ontology` | ? | NetworkPolicy 차단 |

차단된 것들은 각 네임스페이스의 `default-deny` + 짝 앱만 허용하는 정책 때문이다.
쓰려면 소유자에게 우리 앱을 허용 대상에 넣어달라고 해야 한다.

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
- **Fuseki 장애**: 적재만 502로 실패하고 이미 들인 문서는 그대로다. 위키는 영향 없다
- **`/graph`는 위키 문서만 그린다.** 온톨로지 개체를 캔버스에 얹던 레이어는 걷어냈다 — 개체는 이제 문서 자체다
- **Fuseki 질의 경로**는 `/{dataset}/sparql`이다. `/query`는 405를 준다

## 범위 밖 (v1)

인증·멀티테넌트·문서 업로드/파싱/청킹/임베딩·벡터검색·RAG 채팅·Fuseki 쓰기.
