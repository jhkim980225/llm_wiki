"""feda 클러스터 원버튼 배포.

    py deploy/deploy.py 0.11.0            # 빌드 → 반입 → 적용 전부
    py deploy/deploy.py 0.11.0 --skip-build   # 이미지가 이미 있을 때

비밀번호는 FEDA_PW 환경변수로 준다 (스크립트·리포에 넣지 않는다):
    $env:FEDA_PW = '...'; py deploy/deploy.py 0.11.0

경로 사정 (2026-08-04 실측):
- 레지스트리가 없어 tar를 worker01(192.168.0.103) containerd에 직접 넣는다
- kubectl은 마스터(192.168.0.200)의 feda 계정에서만 된다 — 워커엔 kubeconfig가 없다
- SSH는 패스워드 인증만 받는다. 그래서 paramiko를 쓴다 (pip install paramiko)
"""
import gzip
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import paramiko

WORKER = "192.168.0.103"   # fedaworker01 — nodeSelector가 이 노드에 고정한다
MASTER = "192.168.0.200"
USER = "feda"
ROOT = Path(__file__).resolve().parent.parent
YAML = ROOT / "deploy" / "k8s.yaml"


def sh(cmd: list[str]):
    print("$", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True, cwd=ROOT)


def connect(host: str, pw: str) -> paramiko.SSHClient:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(host, username=USER, password=pw, timeout=15)
    return c


def run(cli: paramiko.SSHClient, cmd: str, pw: str, sudo: bool = False, timeout: int = 600) -> str:
    print(f"$ {cmd}", flush=True)
    stdin, stdout, _ = cli.exec_command(cmd, get_pty=True, timeout=timeout)
    if sudo:
        stdin.write(pw + "\n")
        stdin.flush()
    out = stdout.read().decode(errors="replace")
    code = stdout.channel.recv_exit_status()
    print(out.replace(pw, "****"))
    if code != 0:
        sys.exit(f"명령 실패 (exit {code})")
    return out


def run_out(cli: paramiko.SSHClient, cmd: str, pw: str, sudo: bool = False) -> str:
    """run()과 같지만 실패해도 죽지 않는다 — 정리 단계는 배포 성패에 영향을 주면 안 된다."""
    stdin, stdout, _ = cli.exec_command(cmd, get_pty=True, timeout=120)
    if sudo:
        stdin.write(pw + "\n")
        stdin.flush()
    out = stdout.read().decode(errors="replace")
    stdout.channel.recv_exit_status()
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1 or not re.fullmatch(r"\d+\.\d+\.\d+", args[0]):
        sys.exit("사용법: py deploy/deploy.py <버전 예:0.11.0> [--skip-build]")
    ver = args[0]
    skip_build = "--skip-build" in sys.argv
    pw = os.environ.get("FEDA_PW") or sys.exit("FEDA_PW 환경변수가 필요하다")

    tag = f"wiki-graph:{ver}"
    tar = ROOT / f"wiki-graph-{ver}.tar"
    tgz = ROOT / f"wiki-graph-{ver}.tar.gz"

    # 0) package.json 버전 동기화 — UI가 이 값을 하단에 표시한다. 빌드 전에 해야 반영된다.
    pkg = ROOT / "package.json"
    pkg.write_text(
        re.sub(r'"version": "[^"]+"', f'"version": "{ver}"', pkg.read_text(encoding="utf-8"), count=1),
        encoding="utf-8",
    )
    print(f"package.json → {ver}")

    # 1) 빌드 + tar + gzip (업로드가 병목이라 압축이 전체 시간을 크게 줄인다)
    if not skip_build:
        sh(["docker", "build", "-t", tag, "."])
    sh(["docker", "save", tag, "-o", str(tar)])
    t0 = time.time()
    with open(tar, "rb") as fin, gzip.open(tgz, "wb", compresslevel=1) as fout:
        shutil.copyfileobj(fin, fout, 4 * 1024 * 1024)
    print(f"tar {tar.stat().st_size // 1048576}MB → gz {tgz.stat().st_size // 1048576}MB ({time.time() - t0:.0f}초)")
    tar.unlink()

    # 2) k8s.yaml 이미지 태그 갱신 (마이그레이션 이미지는 스키마 바뀔 때만 손댄다)
    text = YAML.read_text(encoding="utf-8")
    text = re.sub(r"image: wiki-graph:\d+\.\d+\.\d+", f"image: {tag}", text)
    YAML.write_text(text, encoding="utf-8")
    print(f"k8s.yaml → {tag}")

    # 3) worker01에 반입
    w = connect(WORKER, pw)
    print(f"== {WORKER} (worker01) ==")
    sftp = w.open_sftp()
    t0, last = time.time(), [0.0]

    def prog(done, total):
        if time.time() - last[0] > 10:
            last[0] = time.time()
            print(f"  upload {done // 1048576}MB / {total // 1048576}MB", flush=True)

    sftp.put(str(tgz), tgz.name, callback=prog)
    print(f"업로드 {time.time() - t0:.0f}초")
    sftp.close()
    # sudo -S는 stdin에서 암호를 읽는다 — zcat 파이프를 물리면 암호 자리에 tar 바이너리가
    # 들어가 인증이 깨진다. 압축 해제는 별도 단계로, import는 파일 인자로 준다.
    run(w, f"gunzip -f ~/{tgz.name}", pw)
    run(w, f"sudo -S ctr -n k8s.io images import ~/{tar.name}", pw, sudo=True)
    run(w, f"rm ~/{tar.name}", pw)

    # 4) master에서 적용
    m = connect(MASTER, pw)
    print(f"== {MASTER} (master) ==")
    sftp = m.open_sftp()
    sftp.put(str(YAML), "k8s.yaml")
    sftp.close()
    run(m, "kubectl apply -f ~/k8s.yaml", pw)
    run(m, "kubectl rollout status deploy/wiki-graph -n jh-wiki-graph --timeout=300s", pw)
    run(m, "kubectl get pods -n jh-wiki-graph -o wide", pw)
    m.close()

    # 롤아웃 성공 후 정리 — 현재 + 직전 한 버전만 남긴다 (롤백용). 나머지 이미지 삭제.
    def keep_two(vers: list[str]) -> list[str]:
        def key(v: str) -> tuple[int, ...]:
            return tuple(int(x) for x in v.split("."))
        return sorted(set(vers), key=key)[:-2]

    # 서버(containerd) 쪽
    out = run_out(w, "sudo -S ctr -n k8s.io images ls -q | grep 'wiki-graph:' | grep -v migrate", pw, sudo=True)
    server_vers = re.findall(r"wiki-graph:(\d+\.\d+\.\d+)", out)
    for old in keep_two(server_vers):
        run_out(w, f"sudo -S ctr -n k8s.io images rm docker.io/library/wiki-graph:{old}", pw, sudo=True)
        print(f"서버 이미지 삭제: {old}")
    w.close()

    # 로컬 docker 쪽
    local = subprocess.run(
        ["docker", "images", "wiki-graph", "--format", "{{.Tag}}"],
        capture_output=True, text=True, cwd=ROOT,
    ).stdout.split()
    for old in keep_two([v for v in local if re.fullmatch(r"\d+\.\d+\.\d+", v)]):
        subprocess.run(["docker", "rmi", f"wiki-graph:{old}"], cwd=ROOT)
        print(f"로컬 이미지 삭제: {old}")

    tgz.unlink()
    print(f"DONE — http://{WORKER}:31900")


if __name__ == "__main__":
    main()
