-- 이메일 계정(임시) → 아이디(loginId) 인증 + 워크스페이스 + 세션 + 감사 로그.
-- 기존 "User"는 이메일 기반 시험 계정뿐이라 갈아엎는다 (운영 데이터 없음).
DROP TABLE IF EXISTS "User";

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "loginId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_loginId_key" ON "User"("loginId");

CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

CREATE TABLE "WorkspaceMember" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("workspaceId", "userId"),
    CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId")
      REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId")
      REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");
-- 사용자당 기본 워크스페이스는 하나만 (부분 유니크 — Prisma 스키마로는 표현 불가)
CREATE UNIQUE INDEX "WorkspaceMember_default_one_per_user"
  ON "WorkspaceMember"("userId") WHERE "isDefault";

CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "refreshTokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId")
      REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserSession_refreshTokenHash_key" ON "UserSession"("refreshTokenHash");
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");

CREATE TABLE "LoginAuditLog" (
    "id" BIGSERIAL NOT NULL,
    "userId" TEXT,
    "workspaceId" TEXT,
    "loginId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "failureReason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LoginAuditLog_loginId_createdAt_idx" ON "LoginAuditLog"("loginId", "createdAt");
