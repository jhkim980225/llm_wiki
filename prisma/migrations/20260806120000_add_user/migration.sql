-- 계정 인증(로그인 화면) — 이메일/비밀번호. 해싱은 lib/auth.ts(scrypt).
-- migrate dev가 아니라 손으로 쓴 이유: 기존 이력의 hnsw 수동 SQL 때문에
-- shadow DB 재생이 깨져 있다(20260805064551의 DROP INDEX가 생성보다 앞섬).
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
