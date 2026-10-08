-- AlterTable
ALTER TABLE "JobRun" ADD COLUMN "bossId" TEXT;

-- CreateTable
CREATE TABLE "Heartbeat" (
    "name" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Heartbeat_pkey" PRIMARY KEY ("name")
);
