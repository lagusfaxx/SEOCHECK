-- CreateTable
CREATE TABLE "AiCheck" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "found" BOOLEAN NOT NULL,
    "position" INTEGER,
    "cited" TEXT[],
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalRank" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "position" INTEGER,
    "rating" DOUBLE PRECISION,
    "name" TEXT,
    "top" JSONB NOT NULL DEFAULT '[]',
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocalRank_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiCheck_projectId_checkedAt_idx" ON "AiCheck"("projectId", "checkedAt");

-- CreateIndex
CREATE INDEX "LocalRank_projectId_checkedAt_idx" ON "LocalRank"("projectId", "checkedAt");

-- AddForeignKey
ALTER TABLE "AiCheck" ADD CONSTRAINT "AiCheck_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalRank" ADD CONSTRAINT "LocalRank_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
