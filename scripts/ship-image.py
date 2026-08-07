"""로컬 docker 이미지를 worker01 containerd(k8s.io)에 직접 반입한다.

레지스트리가 없어 deploy.py가 앱 이미지를 tar로 밀어넣는 것과 같은 방식.
deploy.py는 앱 이미지만 다루므로, 스키마가 바뀌어 migrate 이미지를 새로 반입할 때 쓴다.

    $env:FEDA_PW='...'; py scripts/ship-image.py wiki-graph-migrate:0.9.0
"""
import gzip
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import paramiko

WORKER = "192.168.0.103"
USER = "feda"


def main():
    if len(sys.argv) != 2 or ":" not in sys.argv[1]:
        sys.exit("사용법: py scripts/ship-image.py <이미지:태그>")
    tag = sys.argv[1]
    pw = os.environ.get("FEDA_PW") or sys.exit("FEDA_PW 환경변수가 필요하다")

    tmp = Path(tempfile.gettempdir())
    tar = tmp / f"{tag.replace(':', '-').replace('/', '_')}.tar"
    tgz = Path(str(tar) + ".gz")

    print(f"docker save {tag} ...", flush=True)
    subprocess.run(["docker", "save", tag, "-o", str(tar)], check=True)
    with open(tar, "rb") as fi, gzip.open(tgz, "wb", compresslevel=1) as fo:
        shutil.copyfileobj(fi, fo, 4 * 1024 * 1024)
    tar.unlink()
    print(f"gz {tgz.stat().st_size // 1048576}MB → 업로드", flush=True)

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(WORKER, username=USER, password=pw, timeout=15)

    def run(cmd, sudo=False):
        stdin, stdout, _ = c.exec_command(cmd, get_pty=True, timeout=600)
        if sudo:
            stdin.write(pw + "\n")
            stdin.flush()
        out = stdout.read().decode(errors="replace")
        code = stdout.channel.recv_exit_status()
        print(out.replace(pw, "****"))
        if code != 0:
            sys.exit(f"명령 실패 (exit {code})")

    sftp = c.open_sftp()
    sftp.put(str(tgz), tgz.name)
    sftp.close()
    # 파이프(zcat | sudo -S)는 sudo의 stdin을 gzip 데이터가 가로채 비번이 안 들어간다.
    # 서버에서 먼저 풀고, sudo가 파일에서 import하게 한다(stdin은 pty=비번용으로 비워 둠).
    tarname = tgz.name[:-3]  # .gz 제거
    run(f"gunzip -f ~/{tgz.name}")
    run(f"sudo -S ctr -n k8s.io images import ~/{tarname}", sudo=True)
    run(f"rm -f ~/{tarname}")
    c.close()
    tgz.unlink()
    print(f"반입 완료: {tag}")


if __name__ == "__main__":
    main()
