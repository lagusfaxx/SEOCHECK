-- CreateTable
CREATE TABLE "QuotaUsage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotaUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuotaUsage_workspaceId_resource_createdAt_idx" ON "QuotaUsage"("workspaceId", "resource", "createdAt");

-- AddForeignKey
ALTER TABLE "QuotaUsage" ADD CONSTRAINT "QuotaUsage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

