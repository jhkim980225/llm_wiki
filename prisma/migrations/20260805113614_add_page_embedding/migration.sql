-- pgvector 확장 (이미 존재하면 무시)
CREATE EXTENSION IF NOT EXISTS vector;

-- 의미검색용 임베딩 컬럼 (embeddinggemma 768차원)
ALTER TABLE "Page" ADD COLUMN "embedding" vector(768);

-- 코사인 거리 hnsw 인덱스
CREATE INDEX "Page_embedding_idx" ON "Page" USING hnsw ("embedding" vector_cosine_ops);
