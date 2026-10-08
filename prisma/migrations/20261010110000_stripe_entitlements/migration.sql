-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "planValidUntil" TIMESTAMP(3),
ADD COLUMN     "reportCredits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT;

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_stripeCustomerId_key" ON "Workspace"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_stripeSubscriptionId_key" ON "Workspace"("stripeSubscriptionId");

