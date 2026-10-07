-- AlterTable
ALTER TABLE "JobRun" ADD COLUMN     "log" JSONB NOT NULL DEFAULT '[]';
