-- AlterTable
ALTER TABLE "KeywordRun" ADD COLUMN     "sources" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Topic" ADD COLUMN     "forcedSplit" BOOLEAN NOT NULL DEFAULT false;
