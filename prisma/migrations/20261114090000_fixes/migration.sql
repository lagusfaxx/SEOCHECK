-- CreateTable
CREATE TABLE "Fix" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" TEXT NOT NULL DEFAULT '',
    "before" TEXT,
    "after" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "code" TEXT,
    "source" TEXT NOT NULL DEFAULT 'rules',
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "impact" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveSite" (
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "lastSeenUrl" TEXT,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveSite_pkey" PRIMARY KEY ("projectId")
);

-- CreateIndex
CREATE INDEX "Fix_projectId_status_idx" ON "Fix"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Fix_projectId_url_kind_target_key" ON "Fix"("projectId", "url", "kind", "target");

-- CreateIndex
CREATE UNIQUE INDEX "LiveSite_key_key" ON "LiveSite"("key");

-- AddForeignKey
ALTER TABLE "Fix" ADD CONSTRAINT "Fix_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSite" ADD CONSTRAINT "LiveSite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

