CREATE TABLE "WbsFillJob" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "total" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "WbsFillJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WbsFillJob_planId_key" ON "WbsFillJob"("planId");
