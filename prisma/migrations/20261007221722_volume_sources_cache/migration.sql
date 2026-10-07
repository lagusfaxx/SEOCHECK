-- AlterTable
ALTER TABLE "ApiCall" ADD COLUMN     "costUsd" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Keyword" ADD COLUMN     "volumeAt" TIMESTAMP(3),
ADD COLUMN     "volumeMax" INTEGER,
ADD COLUMN     "volumeMin" INTEGER,
ADD COLUMN     "volumeSource" TEXT;

-- AlterTable
ALTER TABLE "KeywordRun" ADD COLUMN     "options" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "VolumeCache" (
    "country" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "volume" INTEGER,
    "volumeMin" INTEGER,
    "volumeMax" INTEGER,
    "cpc" DOUBLE PRECISION,
    "competition" DOUBLE PRECISION,
    "intent" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VolumeCache_pkey" PRIMARY KEY ("country","language","keyword","source")
);

-- CreateTable
CREATE TABLE "VolumeRequest" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "locationCode" INTEGER NOT NULL,
    "keyword" TEXT NOT NULL,
    "projectId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolumeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VolumeCache_country_language_keyword_fetchedAt_idx" ON "VolumeCache"("country", "language", "keyword", "fetchedAt");

-- CreateIndex
CREATE INDEX "VolumeRequest_status_locationCode_language_idx" ON "VolumeRequest"("status", "locationCode", "language");

-- CreateIndex
CREATE INDEX "VolumeRequest_taskId_idx" ON "VolumeRequest"("taskId");
