# GraphWiki 디자인 표준

2026-08-04 제정. 이 문서가 UI의 단일 기준이다. 화면을 만들거나 고칠 때 여기 어긋나면
이 문서를 먼저 고치고 코드를 맞춘다. 요청사항은 이 문서에 반영하며 버전을 남긴다.

## 방향

Linear · GitHub · Notion · Outline 같은 **전문 사내 문서 도구**. AI 서비스 랜딩처럼
보이지 않게 한다.

- 차분한 다크 테마 (단일 테마 — 라이트 없음)
- 정보 밀도는 높게, 장식은 최소로
- 금지: 과도한 카드 · 그라데이션 · 네온/글로우 · 유리 효과 · 이모지 아이콘 · scale 애니메이션
- 아이콘은 **lucide-react**로 통일
- 레이아웃 구분은 테두리 남발 대신 **배경 명도 차이와 여백**으로
- 그림자는 modal · dropdown · popover에만. 일반 패널·카드에는 금지

## 폰트

- 기본(한글·영문·숫자): **Pretendard Variable** (`pretendard` npm 패키지, 자체 서빙)
- 코드 · SPARQL · URI · ID만: **JetBrains Mono**
- serif/명조 금지
- `font-synthesis: none; text-rendering: optimizeLegibility;`

```css
font-family: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

## 타이포그래피

| 용도 | 크기 / 행간 / 굵기 |
|---|---|
| 본문 | 14px / 1.55 / 400 (letter-spacing -0.01em) |
| 보조 텍스트 | 12px / 400 |
| 사이드바 메뉴 | 13px / 500 · 선택 시 600 |
| 섹션 제목 | 18px / 650 |
| 문서 제목 | 30px / 700 / letter-spacing -0.025em |
| 페이지 헤더 제목 | 24px / 700 |
| 버튼 | 13px / 600 |
| 숫자(개수 등) | `font-variant-numeric: tabular-nums` |

## 컬러 토큰 (CSS 변수, `globals.css`)

| 토큰 | 값 | 용도 |
|---|---|---|
| `--bg` | `#111315` | 전체 배경 |
| `--rail-bg` | `#151719` | 글로벌 사이드바 |
| `--tree-bg` | `#181A1D` | 문서 트리 |
| `--main-bg` | `#121416` | 메인 작업 영역 |
| `--panel` | `#1B1E21` | 보조 패널 · 팝오버 |
| `--hover` | `#22262A` | hover 배경 |
| `--sel` | `rgba(45,212,191,.12)` | 선택 배경 |
| `--sel-hover` | `rgba(45,212,191,.17)` | 선택 hover |
| `--text` | `#F1F3F5` | 기본 텍스트 |
| `--text-body` | `#D3D7DC` | 본문 |
| `--text-dim` | `#8B929C` | 보조 |
| `--text-faint` | `#626A74` | 비활성 |
| `--line` | `rgba(255,255,255,.075)` | 기본 border |
| `--line-strong` | `rgba(255,255,255,.12)` | 강한 border |
| `--accent` | `#2DD4BF` | 아래 "accent 사용처"만 |
| `--accent-hover` | `#5EEAD4` | |
| `--danger` | `#F87171` | 파괴적 동작 |
| `--warn` | `#FBBF24` | '확인되지 않음' 배지 |

**accent 사용처 (이외 금지)**: 주요 생성 버튼 · 선택 메뉴의 좌측 indicator · 링크 ·
활성 아이콘 · 그래프 핵심 노드. 메뉴 전체를 초록으로 칠하지 않는다.

## 레이아웃

- 글로벌 사이드바 196px · 문서 트리 290px · 상단 탭 44px
- 패널 사이 1px border (`--line`)
- 콘텐츠 최대 너비 1040px, **왼쪽 기준 정렬** (중앙 몰림 금지)
- 넓은 화면(≥1440px) 우측 목차/그래프 요약 패널 — *후속 과제, 미구현*

### 반응형

- <1280px: 글로벌 사이드바 아이콘 전용 축소
- <1024px: 문서 트리 숨김(토글로 열기) — drawer 전환은 후속 과제
- 모바일: 단일 컬럼 — 후속 과제

## 컴포넌트 규칙

- border-radius: 기본 6px · 큰 컨테이너 8px · modal/popover 최대 10px
- 버튼 높이: small 28 · default 34 · large 40. 아이콘 버튼 30×30. input 34
- hover transition 120~160ms. scale/확대 금지
- `:focus-visible` 명확히 표시. `prefers-reduced-motion` 존중
- `aria-label` 필수 (아이콘 전용 버튼)

공통 컴포넌트 (`src/components/ui/`): `Button` `IconButton` `SidebarItem` `TreeItem`
`SearchInput` `DocumentTab` `EmptyStateAction` + `cn` 유틸(`src/lib/cn.ts`).
색상 hex를 컴포넌트에 직접 쓰지 않는다 — 반드시 토큰.

## 화면별 기준

### 글로벌 사이드바
로고 sans-serif bold, 아이콘-텍스트 간격 8px. 메뉴 아이콘 17px, 항목 높이 36px,
radius 6px. 선택 = 좌측 2px accent indicator + rgba accent 배경 + 아이콘·텍스트 accent.
상단 메뉴 그룹(홈·문서·AI 작성·도우미·소스·휴지통)과 하단 설정 그룹을 분리.

### 문서 트리
상단 한 줄: '문서' 제목 + 새 문서(compact, 30px) + 더보기. 검색창 34px, Search 아이콘 +
`Ctrl+K` 표시. 행 높이 32px, depth 들여쓰기 16px. 폴더/문서 아이콘 구분,
chevron으로 펼침 표시. 개수는 tabular-nums 우측 정렬. 더보기 버튼은 hover 시만.
선택 행 = 좌측 accent line + 약한 배경 + 말줄임.

### 상단 탭
높이 44px, 탭 최대 240px, 말줄임. 활성 탭 = 하단 accent line. 닫기 버튼.
새 문서는 아이콘 버튼. 빈 상태 = 탭 영역 비우고 우측에 작은 안내 문구.

### 빈 문서 화면 (온보딩)
상단에서 72px, 왼쪽 정렬. 제목 'GraphWiki 시작하기' + 설명 1~2줄 +
**compact action list** (카드 3장 금지):
높이 64~72px, radius 8px, 아이콘 32px(Sparkles · FilePlus2 · MessageSquareText),
제목 14px semibold + 설명 13px, hover는 배경·border만.
하단에 kbd 단축키 안내 (Ctrl+K 검색 · Ctrl+N 새 문서). 밝게 강조하지 않는다.

### 문서 상세
제목 30px 아래 **metadata row** (type · updated · author · links) — 큰 카드 금지,
구분선 + grid. 본문 섹션 간 32px, h2 위 40px. 표는 border 최소화 + header 배경만
약간 구분 + 행 hover. 링크는 accent, 밑줄은 hover 시만. '확인되지 않음'은
`--warn` 배지.

### 그래프 기능 표현
메인 화면에 과도 노출 금지. 문서 우측 패널 또는 접는 섹션에 '연결된 노드 · 관계 ·
출처' compact summary — *후속 과제*. 그래프 미리보기는 단색 선 + 작은 노드,
핵심 노드만 accent. 무지개 노드 금지.

### 그래프 뷰 (/graph)
시안: `docs/mockups/graph-view-mockup.html` (2026-08-06). 캔버스 + 우측 인스펙터(300px,
`--tree-bg`, 좌측 1px `--line`) 2단. 캔버스는 `--main-bg` 평면 — 장식·글로우·입자 금지.

- 에지: `rgba(255,255,255,.13)` 1px. 선택 노드 인접 에지만 `.28`
- 노드: 원형 `#24282D` + 1px 테두리, 라인 아이콘. 크기는 degree로만 차등(13~22px)
- 유형 구분은 **아이콘 색만**: concept 회색 · entity 저채도 파랑(`#7C9CC4`) ·
  synthesis 저채도 보라(`#A79BC8`). 노드마다 밝은 색 금지
- 선택 = 1.5px accent 테두리만. 글로우·후광 금지
- 라벨 11px `--text-dim`, 노드 아래 중앙
- 좌상단 범위 라벨 + 문서/연결 수, 좌하단 줌 컨트롤(`--panel` 툴바), 인스펙터 하단
  '문서 열기' outline accent 버튼
- 실데이터가 수만 노드라 화면은 연결 상위 N(기본 200)만 그린다

### 로그인 (/login)
셸(레일·트리) 밖 전체 화면. 좌 45% 브랜드(제목 44px/650 + 설명 + 핵심 기능 2개,
좌하단 그래프 패턴 svg — 투명도 4.5%) · 우 55% 카드(540px, `--tree-bg`, 1px `--line`,
radius 13px, 패딩 52px). 입력 52px, radius 8px, focus는 accent 테두리만.
로그인 버튼 accent 단색, hover 명도만. 소셜 로그인·구분선·글로우 금지.
오류는 자리를 미리 잡아 레이아웃이 안 밀리게. <768px에서 브랜드 영역 숨김.

## 이 코드베이스의 구현 노트

- Tailwind 미사용 — 순수 CSS + CSS 변수로 위 토큰을 구현한다 (스펙의 "CSS variable
  또는 Tailwind theme token" 중 전자)
- Pretendard는 npm `pretendard` dynamic-subset CSS로 자체 서빙 (사내망 오프라인 대응)
- JetBrains Mono는 `next/font/google` (빌드 시 다운로드, 런타임 자체 서빙)
- 테마 토글 제거 — 다크 단일. `data-theme` 분기 삭제
- 그래프 뷰는 `/graph` 라우트. 전용 단축키는 아직 없다

## 변경 이력

- 2026-08-04 v1 — 최초 제정 (다크 단일 테마, Pretendard, lucide, 토큰 체계)
- 2026-08-04 v1.1 — 드래그 드롭 강조는 폴더 행(drop-into)만. 트리 영역 전체 테두리 강조 제거 (기능은 유지)
- 2026-08-06 v1.2 — 그래프 뷰(/graph) 기준 추가. '도입하지 않음' 결정을 뒤집고 옵시디언식 연결 그래프 도입 (시안 docs/mockups/graph-view-mockup.html)
- 2026-08-06 v1.3 — 로그인 화면 기준 추가. 공유 비밀번호 게이트를 이메일/비밀번호 계정 인증으로 교체
