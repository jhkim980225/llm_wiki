# Wiki Graph

사내 Fuseki 온톨로지를 **위키 문서로 들여와** 옵시디언처럼 `[[링크]]`로 오가며 읽고 고치는 앱.
개체를 그래프로 그리지 않는다 — 개체가 문서 자체다.

설계: `docs/superpowers/specs/2026-08-04-wiki-v2-design.md`

## 띄우기

```bash
docker compose up -d          # Postgres (호스트 포트 15432)
cp .env.example .env
npx prisma migrate dev
npm run dev                   # http://localhost:3000
```

화면: `/wiki/<slug>` 문서 · `/sources` 온톨로지 적재 · `/chat` 도우미

왼쪽 레일 맨 아래 **⚙ 설정**에 상태 탭이 있다. 그래프가 지금 붙는지, 어느 것이 비어 있는지,
얼마나 적재됐는지, LLM 백엔드가 살아 있는지를 한 화면에서 본다. **다시 확인**은 차단기를
무시하고 실제로 찔러 보므로 수동 재시도로 쓴다.

## 사내 배포 (k8s)

네임스페이스 `jh-wiki-graph`. 자체 Postgres를 쓰고 다른 네임스페이스 리소스는 건드리지 않는다.

```
UI          http://192.168.0.103:31900   (NodePort 31900)  ← 현재 0.6.0 가동 중
Postgres    클러스터 내부 postgres:5432   (PVC 20Gi, cephfs-sc)
```

배포는 스크립트 하나로 돈다 (빌드 → tar 업로드 → ctr 반입 → kubectl 적용 → 롤아웃 확인):

```powershell
$env:FEDA_PW = '<feda 비밀번호>'
py deploy/deploy.py 0.11.0              # 새 버전 번호를 준다
py deploy/deploy.py 0.11.0 --skip-build # 이미지가 이미 있을 때
```

수동으로 할 때 알아야 할 경로 사정 (스크립트가 대신 처리하는 것들):

- **레지스트리가 없어서** tar를 worker01(192.168.0.103) containerd에 `ctr import`로 직접 넣는다. 이미지 399MB를 gzip으로 눌러 올리고(`zcat | ctr import -`), 배포 성공 시 서버·로컬 모두 현재+직전 1개만 남기고 이미지를 지운다
- **kubectl은 마스터(192.168.0.200) feda 계정에서만 된다.** 워커에는 kubeconfig가 없고, 개발 PC 로컬 kubectl은 딴 클러스터(kind)를 가리킨다
- **SSH는 패스워드 인증만 받는다** (공개키 등록 안 됨). 그래서 스크립트가 paramiko를 쓴다
- 스키마가 바뀌면 마이그레이션 이미지도 새로 반입: `docker build -f Dockerfile.migrate -t wiki-graph-migrate:<버전> .` 후 같은 방식, `k8s.yaml`의 initContainer 태그 갱신
- 이미지를 fedaworker01에만 넣으므로 `nodeSelector`로 그 노드에 고정하고 `imagePullPolicy: Never`
- 마이그레이션은 **전용 이미지**로 돈다. 앱 이미지의 node_modules는 Next standalone이 추려낸 것이라 Prisma CLI의 전이 의존성(`effect` 등)이 없다
- 기본 스토리지클래스 longhorn은 프로비저너가 죽어 있어 `cephfs-sc`를 명시한다
- **클러스터 안에서는 푸세키 3개가 전부 붙는다.** VPN에서 막히던 카카오(30301)도 통과 — NetworkPolicy가 클러스터 내부 트래픽은 허용한다

## 테마

**GraphWiki** — 밝은 문서 도구 룩 (`docs/image/ui디자인2.png` 기준). 흰 바탕,
얇은 회색 경계선, 그린 액센트(`#0aa370`). 기둥 세 개(내비 · 트리 · 본문)가
경계선으로 붙는다. 유리·오로라·세리프는 걷어냈다.

- 본문·표제 모두 IBM Plex Sans KR, 숫자·주소만 Plex Mono
- 라이트가 기본이고 다크 변형이 있다. `localStorage`에 남는다
- 좌측 내비는 라벨 있는 항목(홈·문서·AI 작성·도우미·소스), 검색은 트리 패널 안 입력 하나(Ctrl+K)

밟은 함정:

- **Plex Mono엔 한글 글리프가 없다.** `--font-mono` 뒤에 본문 폰트를 받쳐 두지 않으면
  한글이 시스템 고정폭으로 떨어져 자간이 벌어진다. 글 쓰는 `textarea`는 아예 본문 폰트를 쓴다

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
| `src/lib/fuseki/client.ts` | SPARQL 읽기 + 그래프 3개 동시 조회 (fetch만, 의존성 없음) |
| `src/lib/ontology/source.ts` | 온톨로지 소스 목록 (어휘 차이를 여기서 흡수) |
| `src/lib/ontology/build.ts` | 개체·트리플 → 위키 문서 변환 (순수 함수) |
| `src/lib/ontology/import.ts` | 대량 적재 (수만 건 배치 upsert) |
| `src/lib/pages/save.ts` | 저장 트랜잭션 — 리비전·백링크·낙관적 잠금 |
| `src/lib/pages/linkify.ts` | 본문에 이름이 나오는 문서를 찾아 링크 제안 |
| `src/lib/folders/tree.ts` | 폴더 순환 검사·경로 캐시 재계산 |
| `src/lib/llm/provider.ts` | LLM 백엔드 선택 + thinking 끄기 |
| `src/lib/agent/tools.ts` | LLM이 위키를 편집하는 툴 8종 |
| `src/components/vault/` | 볼트 껍데기 — 레일·파일트리·CRUD 대화상자 |

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
소스 id는 `src/lib/ontology/source.ts`에 있다. **NodePort라도 파드가 도는 노드로만 붙는다** —
각 네임스페이스에 `default-deny`가 걸려 있어서다.

| id | 서비스 | 주소 | 트리플 | 개발 PC(VPN)에서 |
|---|---|---|---|---|
| `ejkim` | ejkim-ontology/fuseki | 192.168.0.114:30303 | 707,990 (named graph) | 열림 |
| `seunghoon` | seunghoon-ontology/fuseki | 192.168.0.100:30310 | 169,373 | 열림 |
| `kakao` | ejkim-ontology/fuseki-kakao | 192.168.0.114:30301 | ? | **막힘 — 정책에 VPN 대역 없음** |
| (조회 안 함) | jh-llm-wiki/fuseki | 192.168.0.100:31406 | 0 | 열림 |

`weknora`(31406)는 이 앱 자신의 데이터셋이고 비어 있어 `QUERY_SOURCES`에서 뺐다. 적재 대상으로만 남는다.

**안 붙이는 것**: 클러스터에 `fuseki-jinwoo`(192.168.0.112:30306, 74,588 트리플)와
`fuseki-manager`(192.168.0.111:30308, 111,159 트리플)도 떠 있고 개발 PC에서 붙는 것도 확인했지만,
쓰지 않기로 해서 소스에 넣지 않았다. 나중에 필요하면 관계 접두사가 각각
`urn:feda:mailgraph:v6:vocab/`, `http://example.org/sj-help/kg#`다.

**kakao(30301)는 죽은 게 아니다.** 실측 2026-08-04: `fuseki-kakao-0` Running(5일 무재시작),
엔드포인트 정상, ejkim의 fuseki와 **같은 노드**(fedaworker12). 막는 건 NetworkPolicy 하나다.

```
fuseki-allow-required-traffic (30303) → ingress 192.168.0.0/16 + 10.8.0.0/24
fuseki-kakao-allow            (30301) → ingress 192.168.0.0/16 만
```

`10.8.0.0/24`가 VPN 대역이다. 개발 PC(10.8.0.x)가 허용 목록에 없어 패킷이 조용히 버려지고,
TCP 연결이 완료되지 않아 10초쯤 뒤 타임아웃난다. **클러스터 안에서는 붙는다** — NodePort로
부르면 노드 IP로 SNAT돼 `192.168.0.0/16`에 걸린다.

개발 PC에서도 쓰려면 **소유자에게** 아래를 요청해야 한다 (ejkim 쪽 정책과 같은 모양):

```bash
kubectl patch networkpolicy fuseki-kakao-allow -n ejkim-ontology --type=json \
  -p '[{"op":"add","path":"/spec/ingress/0/from/-","value":{"ipBlock":{"cidr":"10.8.0.0/24"}}}]'
```

다른 팀 네임스페이스라 우리가 직접 바꾸지 않는다.

## LLM이 그래프 3개에 동시에 묻기

채팅에서 `query_knowledge_graph`를 부르면 **세 그래프를 한 번에** 조회한다.
`QUERY_SOURCES`(= `SOURCES`에서 weknora를 뺀 것)가 그 목록이다.

```
GET /api/graphs      # 지금 몇 개가 붙는지 · 소스별 엔드포인트와 지연
```

- **소스마다 어휘가 다르다.** 관계 술어 접두사가 ejkim은 `urn:ejkim:ontology:`,
  kakao는 `urn:feda:kg:vocab/`, 승훈은 `http://seunghoon-ontology/schema#`다.
  예전엔 `urn:weknora:rel:`이 client.ts에 박혀 있어서 다른 소스로 물으면 결과가 늘 0건이었다.
  이제 `source.relationNamespace`에서 온다
- **기본 그래프와 named 그래프를 모두 훑는다.** 승훈은 기본, ejkim·kakao는 named에 둔다
- **한 소스가 죽어도 나머지 답은 온다.** 결과의 `sources[]`에 소스별 성패가 실린다.
  `ok:false`는 "그런 사실이 없다"가 아니라 **"물어보지 못했다"**이고, 시스템 프롬프트가
  LLM에게 둘을 섞지 말라고 지시한다
- **죽은 소스는 60초간 건너뛴다.** 죽은 엔드포인트는 TCP가 끊길 때까지 기다리느라 호출마다
  10초 넘게 먹는다(실측 kakao 10.5초). `AbortSignal`은 응답 대기에만 걸려서 이걸 못 줄인다.
  `GET /api/graphs`는 차단기를 무시하고 실제로 찔러 보므로 수동 재시도로 쓸 수 있다
- **회의록 본문 같은 긴 텍스트는 개체의 속성에 들어 있다.** `withAttributes`를 켜면
  찾은 개체 상위 5건의 속성까지 읽는다. 속성 = 소스 네임스페이스 술어 중 값이 리터럴인 것
- 대화 중 호출이라 타임아웃이 **15초**다 (적재는 120초). 리터럴 스캔만 30초

### 2단계 검색 — 이름으로 먼저, 없으면 본문까지

찾는 말이 늘 개체 이름인 것은 아니다. 실측으로 "글리세롤"은 **두 소스 모두 라벨에 0건**인데
문서 본문·요약 리터럴에는 **21건**(ejkim 5 · 승훈 16) 있다. 이름만 뒤지면 못 찾는다.

그래서 소스마다 이렇게 돈다.

1. **라벨 검색** (`rdfs:label` CONTAINS) — 싸다
2. 빈손이면 **리터럴 검색** — 값 안의 텍스트를 뒤져 `textHits`로 준다

리터럴 검색은 인덱스가 없어 전체 스캔이다. 실측 ejkim 13초, 승훈 0.2초. 그래서 라벨로 찾았으면
아예 가지 않는다. 결과의 `sources[].searchedText`가 그 소스에서 느린 경로를 탔는지 알려준다.

**라벨은 두 번째 질의로 따로 붙인다.** 스캔 질의 안에 `OPTIONAL`로 넣었더니 ejkim이 15초를
넘겨 소스가 통째로 실패했다. 대상 URI가 정해진 뒤의 조회는 주어 인덱스를 타서 싸다.

그리고 **한 질의에서 `anyGraph`를 두 번 쓸 때는 그래프 변수를 다르게 줘야 한다.** 같은 이름을
쓰면 두 패턴이 "같은 named graph 안에" 있을 것을 요구하게 되는데, ejkim은 본문과 라벨이 서로
다른 그래프에 있어서 라벨이 통째로 안 잡혔다.

실측 (2026-08-04, "글리세롤"):

```
textHits 21건 (ejkim 5 · 승훈 16) · 라벨 21/21 · 10.6초
병목은 ejkim이 아니라 죽어 있는 kakao의 소켓 타임아웃이다
```
- weknora는 이 앱 자신의 데이터셋이고 비어 있어서 조회 대상에서 뺐다. 적재 대상으로만 남는다

**어느 쪽을 쓸지**: 이미 적재된 내용을 찾는 거라면 `wiki_search`가 훨씬 빠르다
(Postgres 45ms vs 네트워크 왕복 3회). 그래프 직접 조회는 적재 시점 이후의 최신 관계가
필요할 때 쓴다.

## 그래프 RAG — 질문 하나로 위키 문서 쓰기

```
POST /api/compose   {"request":"글리세롤이 들어간 제품과 관련 문서를 정리해줘",
                     "slug":"...", "save":false}
```

채팅 도우미와 다른 점은 **순서가 고정**이라는 것이다. 채팅은 LLM이 매번 어떤 도구를 어떤
순서로 부를지 정해 같은 질문에도 다르게 답한다. 여기는 늘 같은 길을 간다.

```
1) 용어 추출   요청에서 검색어를 뽑는다 (일반 명사는 빼도록 지시)
2) 3소스 조회  라벨 → 빈손이면 리터럴 (용어마다 따로 판단)
3) 근거 수집   찾은 개체의 속성을 읽는다. 라벨로 못 찾았으면 textHits에서 읽는다
4) 작성        근거만 가지고 마크다운 문서를 쓴다. 출처와 조회 실패를 본문에 남긴다
```

**기본은 저장하지 않는다.** `save:true`를 줘야 위키에 쓴다(`lastEditSource='agent'`,
`pageType='synthesis'`). LLM이 쓴 문서가 조용히 쌓이면 나중에 무엇이 사람 글인지 구분이 안 된다.

**응답은 NDJSON 스트림이다.** 작성 단계가 전체 시간의 대부분이라(실측 233초 중 약 210초)
다 끝나고 한꺼번에 주면 사용자가 4분 가까이 빈 화면을 본다. 단계마다 흘려보낸다.

```
{"stage":"terms","terms":[...]}          용어 추출 끝
{"stage":"graph","graph":{...},...}      조회 끝 (소스별 성패 포함)
{"stage":"delta","text":"…"}             작성 중 토큰
{"stage":"done","draft":{...}}           완성
```

실측 (2026-08-04, 배포 환경, "글리세롤이 들어간 제품과 관련 문서를 정리해줘"):

```
 2.8초  용어 ['글리세롤']
16.0초  그래프 3/3 조회 완료 · 근거 6건
25.0초  ← 첫 글자 등장
233초   완료 (델타 1,144개)
```

**클러스터 안에서는 kakao까지 3/3 붙는다.** 개발 PC에서만 NetworkPolicy에 막힌다.

알아둘 것:

- **`generateObject`를 쓰지 않는다.** 사내 vLLM은 구조화 출력(guided decoding)을 지원하지 않아
  `No object generated: response did not match schema`로 죽는다. `lib/llm/json.ts`가 평문으로
  받아 직접 파싱하고 zod로 검증한다 — 백엔드를 안 가린다
- **근거 길이에 전체 예산(12,000자)이 걸려 있다.** 개체마다 자르는 것만으로는 부족했다.
  `extractedText`를 가진 문서 개체가 몇 개만 걸려도 실측 88,901자가 나왔고, 그대로 넘기면
  컨텍스트 32k를 넘겨 응답이 돌아오지 않는다
- **느리다. 220초 중 약 210초가 작성 단계다.** 32B 모델이 긴 마크다운을 생성하는 시간이라
  구조로는 줄이기 어렵다. 체감을 줄이려면 스트리밍이 필요하다

## 링크 잇기

편집 중 **"링크 잇기"**를 누르면 본문에 이름이 나오는 다른 문서를 찾아 첫 출현을 `[[링크]]`로
감싼 결과를 diff로 보여준다. 적용해도 저장되지는 않는다 — 저장은 늘 낙관적 잠금 경로다.

- 후보 좁히기는 Postgres 한 방(`position(title IN $content)`). **97k 문서에 45ms**
- **2자 이하 제목은 뺀다.** 온톨로지 라벨 "판매", "값"이 거의 모든 문서에 걸린다
- **`aliases`는 후보로 안 쓴다.** 적재가 거기에 RDF 타입명("제품", "조직")을 넣어 동의어가 아니다
- **동명이인은 같은 소스 것을 고르고, 그래도 둘이면 버린다.** 어디로 걸지 정할 근거가 없으면 안 건다
- 코드 블록과 이미 걸린 링크는 건드리지 않는다
- **온톨로지 문서를 편집하면 다음 재적재에서 영영 건너뛴다** (`lastEditSource`가 `user`가 되므로).
  편집기가 그 사실을 경고로 띄운다

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
- **version 증가 조건**: title·content·summary·pageType·status가 실제로 바뀔 때만. 링크 유지보수·경로 재계산 같은 장부성 쓰기는 건드리지 않아 "편집됨" 신호가 오염되지 않는다
- **검색에 인덱스가 없다.** 한국어는 부분문자열 매칭이 유일하게 맞는데 tsvector는 토크나이저가 없고 pg_trgm은 2~3자 질의(가장 흔한 길이)에 안 걸린다. 제목·요약만이면 40ms, 본문까지 훑으면 320ms다. 랭킹상 제목 매치가 본문 매치를 늘 이기므로 제목·요약으로 limit이 차면 본문은 안 훑는다
- **큰 폴더 이름 변경은 느리다.** 72,186건 폴더에서 경로 캐시 재계산이 45초다 — 행 재기록 자체가 값이라 이 스키마에선 바닥값이다. 대신 이름·부모가 실제로 바뀔 때만 돌게 막아서, `sortOrder` 변경 같은 건 0.14초다
- **문서 이동은 `version`을 올리지 않는다.** 장부성 쓰기이고, 폴더 전체를 훑는 재계산도 부르지 않는다
- **모든 이동이 맨 `<a href>`다.** `next/link`를 쓰지 않아 화면마다 풀 리로드가 난다. 그래서 탭 목록은 React 상태가 아니라 localStorage에 산다
- **Fuseki 장애**: 적재만 502로 실패하고 이미 들인 문서는 그대로다. 위키는 영향 없다
- **Fuseki 질의 경로**는 `/{dataset}/sparql`이다. `/query`는 405를 준다

## 범위 밖

인증·멀티테넌트·문서 업로드/파싱/청킹/임베딩·벡터검색·RAG 채팅·Fuseki 쓰기·WYSIWYG·
그래프 뷰(`70a9604`에서 삭제)·드래그앤드롭·`pageType`/`aliases` 편집.
