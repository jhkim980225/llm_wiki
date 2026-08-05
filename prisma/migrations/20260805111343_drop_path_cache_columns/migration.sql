-- DropIndex
DROP INDEX "Page_wikiPath_idx";

-- AlterTable
ALTER TABLE "Page" DROP COLUMN "categoryPath",
DROP COLUMN "depth",
DROP COLUMN "wikiPath";
