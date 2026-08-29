"""LightRAG 위키 시드 — docs/light-rag/wiki/{entities,sources}/*.md 중
status: reviewed만 골라 LightRAG에 색인한다.

    $env:FEDA_PW = '...'; py scripts/lightrag-wiki-seed.py       # 기본 5건
    py scripts/lightrag-wiki-seed.py --limit 20                  # 건수 조절
    py scripts/lightrag-wiki-seed.py --id seongjin --id jeong-ara
    py scripts/lightrag-wiki-seed.py --dry-run                   # 전송 없이 미리보기
    py scripts/lightrag-wiki-seed.py --query "정원가게는 어떤 회사야?"

상세: docs/light-rag/wiki/시드-스크립트.md

경로: 개발 PC(VPN)는 NodePort 접근이 막힐 수 있어(카카오 Fuseki 전례) 전송은
마스터(200) SSH 경유다 — 문서 읽기는 로컬 파일이라 SSH 불필요.
사용량 상한: MAX_ASYNC_LLM=2라 문서당 2~4분 순차 처리 — 기본 5건으로 상한.
같은 id 재색인은 거부된다("already contains") — 갱신하려면 WebUI에서 먼저 지울 것.
"""
import argparse
import base64
import json
import os
import re
import sys
from pathlib import Path

import paramiko

MASTER = "192.168.0.200"
USER = "feda"
LIGHTRAG = "http://192.168.0.103:31930"   # NodePort (worker01)
API_KEY = "lightrag-poc-sj-2026"          # deploy/k8s.yaml LIGHTRAG_API_KEY와 동일
WIKI_ROOT = Path(__file__).resolve().parent.parent / "docs" / "light-rag" / "wiki"
SUBDIRS = ("entities", "sources", "concepts")

FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.S)
FIELD_RE = re.compile(r"^(\w+):\s*(.*)$")


def parse_doc(path: Path) -> dict | None:
    m = FRONTMATTER_RE.match(path.read_text(encoding="utf-8"))
    if not m:
        return None
    fm = {}
    for line in m.group(1).split("\n"):
        km = FIELD_RE.match(line)
        if km:
            fm[km.group(1)] = km.group(2).strip()
    if fm.get("status") != "reviewed":
        return None
    return {"id": fm.get("id", path.stem), "title": fm.get("title", path.stem), "body": m.group(2).strip()}


def collect_docs(ids: list[str]) -> list[dict]:
    docs = []
    for sub in SUBDIRS:
        for f in sorted((WIKI_ROOT / sub).glob("*.md")):
            doc = parse_doc(f)
            if doc is None:
                continue
            if ids and doc["id"] not in ids:
                continue
            docs.append(doc)
    return docs


def run(cli: paramiko.SSHClient, cmd: str) -> str:
    _, stdout, stderr = cli.exec_command(cmd, timeout=300)
    out = stdout.read().decode(errors="replace")
    code = stdout.channel.recv_exit_status()
    if code != 0:
        sys.exit(f"명령 실패 (exit {code}): {cmd}\n{out}\n{stderr.read().decode(errors='replace')}")
    return out


def curl_json(cli, path: str, payload: dict) -> dict:
    # 셸 이스케이프를 피하려고 base64로 넘긴다 — 본문에 한글·따옴표·개행이 가득하다
    b64 = base64.b64encode(json.dumps(payload).encode()).decode()
    out = run(
        cli,
        f"echo {b64} | base64 -d | curl -s -X POST {LIGHTRAG}{path} "
        f"-H 'Content-Type: application/json' -H 'X-API-Key: {API_KEY}' -d @-",
    )
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        sys.exit(f"LightRAG 응답이 JSON이 아니다: {out[:500]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=5, help="색인 문서 수 (기본 5 — 속도·비용 상한)")
    ap.add_argument("--id", action="append", default=[], help="특정 문서 id (반복 지정, --limit 무시)")
    ap.add_argument("--dry-run", action="store_true", help="전송 없이 대상·본문만 출력")
    ap.add_argument("--query", help="색인 후 이 질문으로 /query 테스트 (hybrid)")
    args = ap.parse_args()

    docs = collect_docs(args.id)
    if not args.id:
        docs = docs[: args.limit]
    if not docs:
        sys.exit("색인 대상이 없다 (status: reviewed 문서가 없거나 --id가 안 맞음)")

    print(f"대상 {len(docs)}건: {', '.join(d['id'] for d in docs)}")

    if args.dry_run:
        for d in docs:
            print(f"\n--- {d['id']} ({len(d['body'])}자) ---")
            print(d["body"][:300])
        return

    pw = os.environ.get("FEDA_PW") or sys.exit("FEDA_PW 환경변수가 필요하다")
    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(MASTER, username=USER, password=pw, timeout=15)

    for d in docs:
        res = curl_json(cli, "/documents/text", {"text": d["body"], "file_source": d["id"]})
        print(f"색인 요청: {d['id']} ({len(d['body'])}자) → {res}")

    print("색인은 백그라운드 처리 — 상태는 WebUI 문서 탭에서 확인:")
    print(f"  {LIGHTRAG}/webui  (X-API-Key: {API_KEY})")

    if args.query:
        res = curl_json(cli, "/query", {"query": args.query, "mode": "hybrid"})
        print("\n=== /query 응답 ===")
        print(res.get("response", res))

    cli.close()


if __name__ == "__main__":
    main()
