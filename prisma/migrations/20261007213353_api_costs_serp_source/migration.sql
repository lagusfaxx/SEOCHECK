-- AlterTable
ALTER TABLE "SerpSnapshot" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'deep';

-- CreateTable
CREATE TABLE "ApiCall" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "provider" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "ref" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiCall_projectId_createdAt_idx" ON "ApiCall"("projectId", "createdAt");
