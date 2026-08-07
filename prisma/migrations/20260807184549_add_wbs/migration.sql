-- WBS 계획 + 주간일정 (Page_embedding_idx pgvector hnsw는 건드리지 않는다)
CREATE TABLE "WbsPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '새 WBS',
    "weekStart" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WbsPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WbsTask" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "wbsCode" TEXT,
    "title" TEXT NOT NULL,
    "assignee" TEXT,
    "startDate" TEXT,
    "endDate" TEXT,
    "durationDays" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "WbsTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScheduleEntry" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'filled',
    "source" TEXT NOT NULL DEFAULT 'llm',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScheduleEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WbsPlan_userId_workspaceId_updatedAt_idx" ON "WbsPlan"("userId", "workspaceId", "updatedAt");
CREATE INDEX "WbsTask_planId_sortOrder_idx" ON "WbsTask"("planId", "sortOrder");
CREATE INDEX "ScheduleEntry_taskId_date_idx" ON "ScheduleEntry"("taskId", "date");
CREATE UNIQUE INDEX "ScheduleEntry_taskId_date_key" ON "ScheduleEntry"("taskId", "date");

ALTER TABLE "WbsTask" ADD CONSTRAINT "WbsTask_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WbsPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleEntry" ADD CONSTRAINT "ScheduleEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WbsTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
