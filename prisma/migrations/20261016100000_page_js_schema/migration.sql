-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "jsLinks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rawWordCount" INTEGER,
ADD COLUMN     "schemaIssues" TEXT[];
