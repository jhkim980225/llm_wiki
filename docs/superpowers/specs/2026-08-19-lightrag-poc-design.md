# LightRAG PoC (2026-08-19)

## 목적

LightRAG(그래프 추출형 RAG)를 **구경**한다 — 우리 데이터에서 어떤 개체·관계를 뽑고
어떤 답을 주는지 기존 3갈래 RAG와 눈으로 비교. 통합 여부는 그 다음 결정.

## 결정

- **클러스터(k8s) 배포** — jh-wiki-graph에 LightRAG Server 파드 추가(공개 이미지
  `ghcr.io/hkuds/lightrag`, plantuml처럼 노드 직접 pull). 앱 코드 무접촉.
- **LLM은 LUNA(gpt-5.6-luna) 그대로**, 키는 기존 `wiki-graph-llm` Secret 재사용.
- **임베딩은 사내 Ollama embeddinggemma(768d)** — LUNA 임베딩 비용 0.
- **사용량 상한**: 색인 문서 기본 2건 · 문서당 6,000자 절단(시드 스크립트) ·
  `MAX_ASYNC_LLM=2` · `MAX_PARALLEL_INSERT=1`.
- 저장은 **emptyDir** — 2건짜리 색인은 재시작 시 다시 넣는 게 PVC보다 싸다.
- WebUI·API는 NodePort **31930**, `LIGHTRAG_API_KEY`로 보호(X-API-Key).

## 구성 요소

| 것 | 역할 |
|---|---|
| `deploy/k8s.yaml` lightrag 블록 | Deployment + NodePort Service. 제거 = 블록 삭제 |
| `scripts/lightrag-seed.py` | 마스터 SSH(paramiko, FEDA_PW) → postgres 파드 psql로 문서 N건 추출 → 마스터에서 curl로 LightRAG insert. 인자로 건수·slug 지정 |

시드가 SSH 경유인 이유: 개발 PC(VPN)에서 NodePort 접근이 소스별로 막혀 있어
(kakao Fuseki 전례) 마스터 경유가 유일하게 확실한 경로다.

## 구경 포인트

- WebUI(`http://192.168.0.103:31930/webui`) 그래프 탭 — 추출된 개체·관계
- `/query` (mode: local/global/hybrid/naive/mix) 답변을 기존 `/ask`와 비교

## 하지 않는 것

- 앱 통합(4번째 검색기), PVC, 대량 색인, `insert_custom_kg`(온톨로지 직접 주입 —
  우리 데이터엔 장기적으로 이게 맞지만 구경 결과 보고)
