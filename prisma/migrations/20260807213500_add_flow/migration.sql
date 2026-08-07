-- FLOW 배치 작업 + 실행 이력 (Page_embedding_idx pgvector hnsw는 건드리지 않는다)
CREATE TABLE "FlowTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "templateSlug" TEXT NOT NULL,
    "targetFolderId" TEXT,
    "targetFolderName" TEXT,
    "scheduleWeekday" INTEGER NOT NULL DEFAULT 1,
    "scheduleHour" INTEGER NOT NULL DEFAULT 9,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FlowTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FlowRun" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "trigger" TEXT NOT NULL DEFAULT 'schedule',
    "resultSlug" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "FlowRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FlowTask_workspaceId_deletedAt_nextRunAt_idx" ON "FlowTask"("workspaceId", "deletedAt", "nextRunAt");
CREATE INDEX "FlowRun_flowId_startedAt_idx" ON "FlowRun"("flowId", "startedAt");
CREATE INDEX "FlowRun_startedAt_idx" ON "FlowRun"("startedAt");

ALTER TABLE "FlowRun" ADD CONSTRAINT "FlowRun_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "FlowTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
