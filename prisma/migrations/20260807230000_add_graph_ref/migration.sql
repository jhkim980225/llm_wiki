-- 그래프 개체 참조 (Page_embedding_idx pgvector hnsw는 건드리지 않는다)
CREATE TABLE "GraphRef" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "uri" TEXT,
    "sparql" TEXT NOT NULL DEFAULT '',
    "pageSlug" TEXT NOT NULL,
    "promoted" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GraphRef_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GraphRef_sourceId_name_key" ON "GraphRef"("sourceId", "name");
CREATE INDEX "GraphRef_name_idx" ON "GraphRef"("name");
CREATE INDEX "GraphRef_pageSlug_idx" ON "GraphRef"("pageSlug");
