-- DropIndex
DROP INDEX "Page_embedding_idx";

-- AlterTable
ALTER TABLE "Folder" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Folder_deletedAt_idx" ON "Folder"("deletedAt");
