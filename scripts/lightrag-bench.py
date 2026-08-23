"""LightRAG vs 기존 RAG(그래프 기반 채팅) 벤치마크.

    py scripts/lightrag-bench.py                 # 15문항 전체 (수십 분 — 채팅이 문항당 1~3분)
    py scripts/lightrag-bench.py --n 3           # 앞 3문항만 (스모크)
    py scripts/lightrag-bench.py --mode mix      # LightRAG 모드 변경 (기본 hybrid)

같은 질문을 두 경로에 던진다:
  A. LightRAG  — POST /api/lightrag (그래프+벡터 자체 검색, LUNA 생성)
  B. 기존 RAG  — POST /api/chat ephemeral (소스 RAG·위키 검색 도구, LUNA 생성, 저장 없음)
결과는 docs/light-rag/벤치마크-<날짜>.md 에 문항별 나란히 기록한다.
bench 계정 필요 (비밀번호는 실행 시 BENCH_PW 환경변수, 기본 1234).
"""
import argparse
import datetime
import os
import sys
import time

import requests

BASE = "https://cloud.fedaground.com/graphwiki"

# 색인 30건 기반, 검토.md 5절의 질문 유형을 커버한다
QUESTIONS = [
    ("원문 세부", "정재윤테라피 버블폼토너 단가 협의에서 오간 금액은 얼마인가?"),
    ("원문 세부", "코바상사에 납품한 타임리커버리 이지에프 세럼은 몇 개였나?"),
    ("단일 사실", "최담선 연구소장의 담당 영역은 뭐야?"),
    ("개체 중심", "정아라 연구원이 담당하는 업무와 진행 중인 건을 정리해줘"),
    ("개체 중심", "코바상사와의 거래 이력을 정리해줘"),
    ("주제·관계", "성진의 견적서 작성과 단가 결정은 어떤 흐름으로 이뤄지나?"),
    ("주제·관계", "원료 구매부터 발주까지 전체 프로세스를 설명해줘"),
    ("복합", "김종태 대표이사가 최근 내린 주요 의사결정과 그 배경은?"),
    ("복합", "어바운드이든영컴퍼니 바디로션·핸드크림 제형 개발 건은 어떻게 진행되고 있나?"),
    ("복합", "두피케어 제품 라인과 관련 거래처 현황을 같이 정리해줘"),
    ("요약", "8월 주간 업무내역들을 종합하면 생산·출고 쪽에서 반복된 이슈는 뭐였나?"),
    ("복합", "기능성 화장품 보완자료 제출과 MSDS 관리는 각각 누가 어떻게 챙기고 있나?"),
    ("원문 세부", "세금계산서 발행과 입금 관리에서 최근 처리된 건들을 알려줘"),
    ("주제·관계", "제조원가표는 어떤 기준으로 작성되나?"),
    ("요약", "주식회사 성진의 주요 거래처 현황을 요약해줘"),
]


def login(s: requests.Session, pw: str):
    r = s.post(f"{BASE}/api/auth/login", json={"loginId": "bench", "password": pw}, timeout=30)
    if r.status_code != 200:
        sys.exit(f"bench 로그인 실패 {r.status_code}: {r.text[:200]}")


def ask_lightrag(s: requests.Session, q: str, mode: str) -> tuple[str, float]:
    t0 = time.time()
    r = s.post(f"{BASE}/api/lightrag", json={"query": q, "mode": mode}, timeout=300)
    took = time.time() - t0
    if r.status_code != 200:
        return f"(오류 {r.status_code}: {r.text[:200]})", took
    return r.json().get("response", "(빈 응답)"), took


def ask_chat(s: requests.Session, q: str) -> tuple[str, float]:
    t0 = time.time()
    r = s.post(
        f"{BASE}/api/chat",
        json={"messages": [{"role": "user", "content": q}], "ephemeral": True},
        stream=True,
        timeout=600,
    )
    if r.status_code != 200:
        return f"(오류 {r.status_code}: {r.text[:200]})", time.time() - t0
    chunks = [c for c in r.iter_content(chunk_size=None) if c]
    return b"".join(chunks).decode("utf-8", errors="replace"), time.time() - t0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=len(QUESTIONS), help="문항 수 제한")
    ap.add_argument("--mode", default="hybrid", help="LightRAG 모드 (기본 hybrid)")
    args = ap.parse_args()

    s = requests.Session()
    login(s, os.environ.get("BENCH_PW", "1234"))

    today = datetime.date.today().isoformat()
    out_path = f"docs/light-rag/벤치마크-{today}.md"
    rows = []
    body = []
    for i, (kind, q) in enumerate(QUESTIONS[: args.n], 1):
        print(f"[{i}/{args.n}] {q}", flush=True)
        lr_ans, lr_t = ask_lightrag(s, q, args.mode)
        print(f"  LightRAG {lr_t:.1f}초", flush=True)
        ch_ans, ch_t = ask_chat(s, q)
        print(f"  기존 채팅 {ch_t:.1f}초", flush=True)
        rows.append(f"| {i} | {kind} | {lr_t:.1f}초 | {ch_t:.1f}초 | | |")
        body.append(
            f"## {i}. [{kind}] {q}\n\n"
            f"### A. LightRAG ({args.mode}, {lr_t:.1f}초)\n\n{lr_ans}\n\n"
            f"### B. 기존 채팅 ({ch_t:.1f}초)\n\n{ch_ans}\n"
        )

    md = (
        f"# LightRAG 벤치마크 — {today}\n\n"
        f"색인 30건 · LightRAG 모드 {args.mode} · 기존측은 채팅(ephemeral, 소스 RAG·위키 검색 도구).\n"
        f"생성 LLM은 양쪽 다 gpt-5.6-luna — 검색·근거 구성 차이만 비교된다.\n"
        f"실행: `py scripts/lightrag-bench.py` (bench 계정)\n\n"
        "## 요약표 (정확/우세 열은 사람이 채운다)\n\n"
        "| # | 유형 | LightRAG | 기존 | 정확한 쪽 | 비고 |\n|---|---|---|---|---|---|\n"
        + "\n".join(rows)
        + "\n\n---\n\n"
        + "\n---\n\n".join(body)
    )
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(md)
    print(f"\n결과 저장: {out_path}")


if __name__ == "__main__":
    main()
