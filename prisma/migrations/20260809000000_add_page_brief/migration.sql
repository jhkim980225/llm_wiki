-- 적재본 문서의 열람 시점 요약 캐시.
-- brief: LLM이 쓴 요약, briefHash: 요약을 만든 본문의 해시(본문이 바뀌면 어긋나 재생성).
ALTER TABLE "Page" ADD COLUMN "brief" TEXT;
ALTER TABLE "Page" ADD COLUMN "briefHash" TEXT;
