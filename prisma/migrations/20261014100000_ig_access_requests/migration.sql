-- CreateTable
CREATE TABLE "IgAccessRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IgAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IgAccessRequest_status_createdAt_idx" ON "IgAccessRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IgAccessRequest_projectId_username_key" ON "IgAccessRequest"("projectId", "username");

-- AddForeignKey
ALTER TABLE "IgAccessRequest" ADD CONSTRAINT "IgAccessRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
