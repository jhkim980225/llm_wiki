"""LightRAG PoC 시드 — 운영 위키 문서 소량을 LightRAG에 색인한다.

    $env:FEDA_PW = '...'; py scripts/lightrag-seed.py            # 사람·AI 최근 2건
    py scripts/lightrag-seed.py --limit 3                        # 건수 조절
    py scripts/lightrag-seed.py --slug 회의록/8월-정기회의 --slug 거래처/성진
    py scripts/lightrag-seed.py --query "글리세롤 견적 경위"      # 색인 후 질의 테스트

경로: 개발 PC(VPN)는 NodePort 접근이 막힐 수 있어(카카오 Fuseki 전례) 전부
마스터(200) SSH 경유다 — psql은 kubectl exec, LightRAG 호출은 마스터의 curl.
사용량 상한: 기본 2건 · 문서당 6,000자 절단 (LUNA 호출 최소화).
"""
import argparse
import base64
import json
import os
import sys

import paramiko

MASTER = "192.168.0.200"
USER = "feda"
NS = "jh-wiki-graph"
LIGHTRAG = "http://192.168.0.103:31930"   # NodePort (worker01)
API_KEY = "lightrag-poc-sj-2026"          # deploy/k8s.yaml LIGHTRAG_API_KEY와 동일
TRUNC = 6000

PSQL = 'kubectl -n {ns} exec deploy/postgres -- psql -U wiki -d wiki -At -c "{sql}"'


def run(cli: paramiko.SSHClient, cmd: str) -> str:
    _, stdout, stderr = cli.exec_command(cmd, timeout=300)
    out = stdout.read().decode(errors="replace")
    code = stdout.channel.recv_exit_status()
    if code != 0:
        sys.exit(f"명령 실패 (exit {code}): {cmd}\n{out}\n{stderr.read().decode(errors='replace')}")
    return out


def fetch_docs(cli, slugs: list[str], limit: int) -> list[dict]:
    if slugs:
        quoted = ",".join("'" + s.replace("'", "''") + "'" for s in slugs)
        where = f'\\"deletedAt\\" IS NULL AND slug IN ({quoted})'
    else:
        # 사람·AI가 쓴 문서 우선 — 적재본은 그래프 조회와 중복이라 구경 가치가 낮다.
        # 빈 깡통(무제 테스트 문서)이 걸리지 않게 본문 500자 이상만.
        where = (
            '\\"deletedAt\\" IS NULL AND \\"lastEditSource\\" IN (\'user\',\'agent\') '
            'AND length(content) >= 500'
        )
    sql = (
        "SELECT COALESCE(json_agg(t), '[]') FROM (SELECT slug, title, content FROM \\\"Page\\\" "
        f"WHERE {where} ORDER BY \\\"updatedAt\\\" DESC LIMIT {limit}) t"
    )
    return json.loads(run(cli, PSQL.format(ns=NS, sql=sql)))


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
    ap.add_argument("--limit", type=int, default=2, help="색인 문서 수 (기본 2 — LUNA 비용 상한)")
    ap.add_argument("--slug", action="append", default=[], help="특정 문서 slug (반복 지정)")
    ap.add_argument("--query", help="색인 후 이 질문으로 /query 테스트 (hybrid)")
    args = ap.parse_args()
    pw = os.environ.get("FEDA_PW") or sys.exit("FEDA_PW 환경변수가 필요하다")

    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(MASTER, username=USER, password=pw, timeout=15)

    docs = fetch_docs(cli, args.slug, args.limit)
    if not docs:
        sys.exit("조건에 맞는 문서가 없다")
    for d in docs:
        text = f"# {d['title']}\n\n{d['content'][:TRUNC]}"
        res = curl_json(cli, "/documents/text", {"text": text, "file_source": d["slug"]})
        print(f"색인 요청: {d['slug']} ({len(text)}자) → {res}")

    print("색인은 백그라운드 처리 — 상태는 WebUI 문서 탭에서 확인:")
    print(f"  {LIGHTRAG}/webui  (X-API-Key: {API_KEY})")

    if args.query:
        res = curl_json(cli, "/query", {"query": args.query, "mode": "hybrid"})
        print("\n=== /query 응답 ===")
        print(res.get("response", res))

    cli.close()


if __name__ == "__main__":
    main()
