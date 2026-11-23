-- AlterTable
ALTER TABLE "Fix" ADD COLUMN     "pushError" TEXT,
ADD COLUMN     "pushedAt" TIMESTAMP(3),
ADD COLUMN     "pushedTo" TEXT;

-- CreateTable
CREATE TABLE "CmsConnection" (
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "lastCheckAt" TIMESTAMP(3),
    "lastPushAt" TIMESTAMP(3),
    "info" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsConnection_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contentId" TEXT,
    "keyword" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "title" TEXT NOT NULL DEFAULT '',
    "meta" TEXT NOT NULL DEFAULT '',
    "slug" TEXT NOT NULL DEFAULT '',
    "html" TEXT NOT NULL DEFAULT '',
    "words" INTEGER NOT NULL DEFAULT 0,
    "warnings" TEXT[],
    "error" TEXT,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "published" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Article_projectId_createdAt_idx" ON "Article"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "CmsConnection" ADD CONSTRAINT "CmsConnection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

