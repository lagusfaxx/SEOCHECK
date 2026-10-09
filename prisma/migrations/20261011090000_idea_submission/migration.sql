-- CreateTable
CREATE TABLE "IdeaSubmission" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "idea" TEXT NOT NULL,
    "needs" TEXT[],
    "link" TEXT,
    "ip" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdeaSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdeaSubmission_createdAt_idx" ON "IdeaSubmission"("createdAt");
