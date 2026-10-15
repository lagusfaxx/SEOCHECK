-- AlterTable
ALTER TABLE "VolumeCache" ADD COLUMN     "monthly" JSONB;

-- AlterTable
ALTER TABLE "Keyword" ADD COLUMN     "monthly" JSONB;

-- CreateTable
CREATE TABLE "KeywordGap" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "competitors" TEXT[],
    "items" JSONB NOT NULL,
    "errors" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordGap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KeywordGap_projectId_createdAt_idx" ON "KeywordGap"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "KeywordGap" ADD CONSTRAINT "KeywordGap_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
