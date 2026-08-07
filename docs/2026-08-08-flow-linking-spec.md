# FLOW·노드링크·출처요약·템플릿작성 — 요건정의서 & 구현 플랜

- 작성일: 2026-08-08
- 출처: 담당업무 코멘트(김순역·자승훈, 2026-08-07 스크린샷 3장)
- 대상: GraphWiki (feat/source-apis)

---

## A. 요건정의서

### A1. AI 답변의 노드 링크 + 그래프 연결
- 채팅(`/chat`)·AI 작성(`/ask`) 답변에 **개체(사람·업체명·월/날짜 등)** 가 나오면 반드시 `[[링크]]`로 나와야 하고, 누르면 그 개체의 그래프/위키 페이지로 이동해야 한다.
- 현행: `relatedPagesFor` 기반 링크가 붙지만 **누락이 많다**(코멘트: "각 노드(김윤서·김종태·최담선)에 링크가 있어야").
- 개선: 답변 속 개체명↔위키 slug 매칭률을 높이고, 날짜(2026-07 등)도 링크 대상으로.

### A2. 출처 요약 뷰
- 근거(출처)를 누르면 **원문 덤프가 아니라 요약**이 화면에 떠야 한다. 지금은 너무 많이 나와 무엇을 참조했는지 모른다.
- 개선: 출처 항목 클릭 → 요약 팝오버/패널(핵심 3~5줄 + 원문 링크).

### A3. 템플릿 기반 주간업무내역 자동작성
- 프롬프트 예: *"템플릿 폴더의 [주간업무내역] 문서를 참조해 주간업무내역을 그 양식대로 작성해줘. 저장 위치는 주간업무 폴더."*
- 요구: **템플릿(양식) 문서를 참조** → 그 양식을 지켜 새 문서 작성 → **지정 폴더에 저장**.
- 현행 트리: `템플릿/주간업무내역`(양식 1건), `주간업무/…`(결과 저장처).

### A4. FLOW (배치·스케줄) + 캘린더
- 좌측 사이드바(그래프·채팅 아래)에 **FLOW** 메뉴 신설.
- FLOW에서 A3 같은 작업(프롬프트+템플릿+저장폴더)을 **등록**하고 **주 1회 월요일** 스케줄 지정.
- 스케줄이 **캘린더(신규 화면)** 에 반영. 실행되면 결과 문서가 대상 폴더에 쌓임.
- WBS 일정은 고정 메뉴가 아니라 **템플릿 폴더 문서(양식)** 로 다룬다.

---

## B. 현행 코드 매핑

| 요건 | 관련 현행 |
|---|---|
| A1 링크 | `lib/rag/compose.ts`(relatedPagesFor·sanitizeLinkedText), `chat/route.ts` system, `Markdown`(wikilink→/wiki/slug=개체 페이지) |
| A2 출처 | `/ask` 근거 렌더, 출처배지 CSS(`.prose a.wikilink[...]::after`) |
| A3 템플릿작성 | `/ask` `writeDocStream`+`createOrRivivePage(folderId)`, `Folder` 모델·트리 |
| A4 스케줄러 | **없음**(cron 인프라 없음). WBS `WbsFillJob` 비동기 패턴 재사용 가능 |

---

## C. 구현 플랜 (단계)

### Phase 1 — 노드 링크 강화 + 출처 요약 (기존 개선, 공유파일)
- 링크: 답변 생성 후 개체명(위키에 존재하는 slug/title/alias)과 **본문 표면형 매칭**을 한 번 더 돌려 누락 링크 보강(linkify 재사용). 날짜 표기(YYYY-MM)도 해당 달력/개체 페이지가 있으면 링크.
- 출처 요약: 근거 블록에 원문 대신 **요약 필드**를 함께 저장/전달. 출처 클릭 시 요약 우선 표시, "원문 보기"로 펼침.
- 주의: `compose.ts`/`chat/route.ts`는 다른 세션도 만지는 공유 파일 — 충돌 조심.

### Phase 2 — 템플릿 기반 문서 생성 (신규, 독립)
- API `POST /api/compose`(또는 신규 `/api/flow/run`)에 `templateSlug`, `targetFolderId` 옵션 추가:
  1. 템플릿 문서 본문을 읽어 **양식**으로 프롬프트에 주입
  2. 지시대로 작성(기존 writeDoc 재사용, 근거 결합 유지)
  3. 결과를 `targetFolderId`에 저장(제목·slug 자동)
- 폴더 이름으로 지정("주간업무 폴더")할 수 있게 name→folderId 해석 헬퍼.

### Phase 3 — FLOW 모델 + 메뉴 + 스케줄 + 캘린더 (신규, 큰 덩어리)
- 모델: `FlowTask { id, workspaceId, userId, title, prompt, templateSlug?, targetFolderId?, schedule('weekly-mon' 등), enabled, lastRunAt?, nextRunAt }`, `FlowRun { id, flowId, status, startedAt, finishedAt?, resultSlug?, error? }`
- API: `/api/flow`(CRUD), `/api/flow/[id]/run`(수동 실행 = Phase 2 호출), `/api/flow/tick`(due 실행 — 스케줄러가 부름)
- UI: 사이드바 **FLOW** 메뉴 + `/flow`(등록·목록·이력), `/calendar`(FlowRun·WBS 일정 통합 표시)
- 스케줄러(**결정 필요**):
  - (권장) **k8s CronJob** — 주기적으로 `/api/flow/tick`를 내부 호출(헬스처럼 인증 우회 경로 or 토큰). 안정·앱 재시작 무관.
  - (대안) 앱 내 `setInterval` — 단일 replica라 동작하지만 파드 재시작 시 타이밍 흔들림.

---

## D. 결정 필요
1. **스케줄러 방식**: k8s CronJob vs 앱 내 인터벌 (Phase 3 좌우)
2. **캘린더 데이터원**: FLOW 실행(FlowRun) + WBS 일정(ScheduleEntry) 통합 표시 여부
3. **WBS 메뉴 처리**: 기존 `/wbs` 유지 + 템플릿 문서화 병행 vs 메뉴 제거하고 템플릿·FLOW로 흡수
4. 저장 슬러그/중복 규칙(같은 주간 재실행 시 덮어쓰기 vs 접미사)

---

## E. 착수 순서(제안)
Phase 2(템플릿 작성, 독립) → Phase 3(FLOW·캘린더, 스케줄러 결정 후) → Phase 1(링크·출처, 공유파일이라 다른 세션과 조율). Phase 2가 Phase 3의 실행 엔진이라 먼저.
