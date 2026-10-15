-- CreateTable
CREATE TABLE "BacklinkSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "competitors" TEXT[],
    "summary" JSONB NOT NULL,
    "competitorSummaries" JSONB NOT NULL DEFAULT '[]',
    "referring" JSONB NOT NULL DEFAULT '[]',
    "lost" JSONB NOT NULL DEFAULT '[]',
    "broken" JSONB NOT NULL DEFAULT '[]',
    "gap" JSONB NOT NULL DEFAULT '[]',
    "errors" TEXT[],
    "costUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacklinkSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BacklinkSnapshot_projectId_createdAt_idx" ON "BacklinkSnapshot"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "BacklinkSnapshot" ADD CONSTRAINT "BacklinkSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
