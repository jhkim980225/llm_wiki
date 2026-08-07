# 다른 PC에서 개발·배포하기

이 문서 하나로 새 PC에서 이 프로젝트를 받아 **개발**하고 **사내 k8s에 배포**할 수 있다.
개요·구조는 `README.md`, 클러스터 비밀번호·주소는 `docs/서버정보.md`(git 미포함)를 참고한다.

---

## 0. 저장소

```
git clone https://github.com/jhkim980225/llm_wiki.git
cd llm_wiki
git checkout feat/source-apis      # 현재 작업 브랜치
```

---

## 1. git에 없는 파일 (별도로 받아야 함)

`.gitignore`에 걸려 저장소에 없다. 다른 PC나 기존 PC에서 **직접 복사**해 온다.

| 파일 | 내용 | 없으면 |
|---|---|---|
| `.env` | DB·LLM·임베딩·RAG·AUTH_SECRET 등 런타임 설정 | 앱이 안 뜬다 |
| `docs/서버정보.md` | 클러스터 주소·계정·비밀번호(배포용 `FEDA_PW`) | 배포 불가 |

`.env`는 `.env.example`를 복사해 값을 채워도 된다. 필수 키:

```
DATABASE_URL=postgres://wiki:wiki@localhost:15432/wiki
LLM_BACKEND=openai            # 또는 vllm/ollama
LLM_BASE_URL=...              # openai면 비워서 기본값
LLM_MODEL=gpt-5.6-luna
LLM_API_KEY=sk-...            # openai 백엔드일 때 필수
EMBED_URL=http://192.168.0.152:11434
EMBED_MODEL=embeddinggemma
AUTH_SECRET=<세션 서명 키, 아무 긴 문자열>
# 소스 RAG API는 기본값이 코드에 있어 생략 가능(EJKIM_RAG_URL/KAKAO_RAG_URL/SEUNGHOON_RAG_URL)
```

---

## 2. 개발 환경 (로컬)

전제: Node 22, Docker Desktop, (배포까지 하려면) Python 3 + `pip install paramiko`.

```bash
npm install
docker compose up -d                 # Postgres(pgvector) 호스트 15432
npx prisma migrate deploy            # 스키마 적용 (개발은 migrate dev도 가능)
npx prisma generate
node prisma/seed.mjs                 # 시드 계정: test / test
npm run dev                          # http://localhost:3000 (기본 3000, 점유 시 3001)
```

로그인: `test` / `test`.

**주의(pgvector):** DB 이미지는 `pgvector/pgvector:pg16`이다(의미검색용). Prisma가 hnsw 인덱스를
모델링하지 못해, `prisma migrate dev`를 돌리면 `Page_embedding_idx` DROP을 마이그레이션에 끼워
넣는다. 새 마이그레이션을 만들 땐 그 줄을 지우고 적용한다(`migrate diff`로 생성 → 수정 → `migrate deploy`).

### 테스트

```bash
printf 'DATABASE_URL=postgres://wiki:wiki@localhost:15432/wiki_test\n' > .env.test
DATABASE_URL=postgres://wiki:wiki@localhost:15432/wiki_test npx prisma migrate deploy
npm test          # vitest. 별도 DB(wiki_test)를 비우며 돈다 — 개발 DB 가리키면 안 됨
```

---

## 3. 사내 k8s 배포

**푸시 ≠ 배포다.** CI/CD가 없다. `git push`는 GitHub에만 올라가고, 실제 반영은 아래 스크립트로 한다.

### 사전 조건
- Docker(이미지 빌드), Python 3 + `paramiko`
- 클러스터 SSH 접근(비밀번호 인증). 비번은 `docs/서버정보.md`의 `feda` 계정
- 로컬 kubectl은 못 씀(딴 클러스터 가리킴) — 스크립트가 master에 SSH해서 `kubectl` 실행

### 절차

```powershell
$env:FEDA_PW = '<docs/서버정보.md의 feda 비밀번호>'
py deploy/deploy.py 0.38.0                 # 새 버전 번호 (직전보다 올림)
# 이미지가 이미 빌드돼 있으면:  py deploy/deploy.py 0.38.0 --skip-build
```

스크립트가 하는 일: 앱 이미지 빌드 → tar+gzip → worker01(192.168.0.103) containerd에 `ctr import`
→ `k8s.yaml`의 이미지 태그·`package.json` 버전 갱신 → master(192.168.0.200)에서 `kubectl apply`
→ 롤아웃 확인. 성공 시 현재+직전 1개만 남기고 이전 이미지 정리.

### 스키마(마이그레이션)가 바뀐 경우에만 추가로
앱 이미지엔 Prisma CLI가 없어 마이그레이션은 **전용 이미지**로 돈다(k8s initContainer).
prisma/migrations에 새 파일을 추가했다면 **앱 배포(py deploy) 전에** migrate 이미지를 새로 반입한다:

```powershell
docker build -f Dockerfile.migrate -t wiki-graph-migrate:<새버전> .
$env:FEDA_PW='...'; py scripts/ship-image.py wiki-graph-migrate:<새버전>   # worker01 containerd로 반입
# deploy/k8s.yaml 의 initContainers image 태그를 <새버전>으로 바꾼 뒤 py deploy/deploy.py 실행
```
`scripts/ship-image.py`는 로컬 docker 이미지를 tar로 눌러 worker01 containerd에 넣는다(deploy.py의
앱 이미지 반입과 같은 방식). 스키마 변경이 없으면 기존 migrate 이미지 그대로 두면 된다(initContainer는 no-op).
initContainer가 `prisma migrate deploy`로 프로덕션 DB에 새 마이그레이션을 적용한다(파드 기동 시 1회).

### 클러스터 사실 (요약, 상세는 서버정보.md)
- 네임스페이스 `jh-wiki-graph`, 앱 NodePort **31900**, 자체 Postgres(PVC 20Gi, `cephfs-sc`)
- 이미지를 fedaworker01에만 넣으므로 `nodeSelector` 고정 + `imagePullPolicy: Never`
- SSH는 비밀번호 인증만. 레지스트리 없음(그래서 tar 직접 반입)

### 롤백
직전 이미지가 서버에 남아 있으므로, `k8s.yaml`의 app image 태그를 직전 버전으로 되돌려
`kubectl apply` 하면 된다(master에서). 또는 `kubectl -n jh-wiki-graph rollout undo deploy/wiki-graph`.

---

## 4. 접속 / DNS

- 사내: `http://192.168.0.103:31900` (NodePort)
- DNS가 이 NodePort로 물려 있으면 도메인으로도 접속된다. **DNS는 항상 "마지막 배포된 이미지"를
  가리킬 뿐** — 새 코드를 올리려면 위 3장 배포를 실행해야 한다.

---

## 5. 자주 막히는 곳
- `prisma generate` EPERM: dev 서버가 query engine dll을 잠금. dev 끄고 다시 generate.
- 배포 이미지 반영 안 됨: 버전 번호를 올렸는지 확인(같은 태그면 노드가 옛 이미지를 씀).
- kakao/ejkim/seunghoon RAG가 개발 PC에서 안 붙음: 소스 NetworkPolicy(대역 허용) 문제 —
  클러스터 안에선 붙는다. 상세는 `src/lib/ontology/source.ts` 주석.
