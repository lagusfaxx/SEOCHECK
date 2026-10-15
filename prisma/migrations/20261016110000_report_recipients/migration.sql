-- AlterTable
ALTER TABLE "ReportSchedule" ADD COLUMN     "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[];
