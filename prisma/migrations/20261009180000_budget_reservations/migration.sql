-- Reservas de presupuesto (sin carreras entre jobs concurrentes)
ALTER TABLE "ProviderUsage" ADD COLUMN "jobRunId" TEXT;
CREATE INDEX "ProviderUsage_jobRunId_idx" ON "ProviderUsage"("jobRunId");

CREATE TABLE "BudgetReservation" (
    "holder" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "usd" DOUBLE PRECISION NOT NULL,
    "label" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BudgetReservation_pkey" PRIMARY KEY ("holder","provider")
);
