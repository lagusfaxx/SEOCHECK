-- ApiCall → ProviderUsage conservando los datos (Prisma generaría DROP + CREATE)
ALTER TABLE "ApiCall" RENAME TO "ProviderUsage";
ALTER TABLE "ProviderUsage" RENAME CONSTRAINT "ApiCall_pkey" TO "ProviderUsage_pkey";

ALTER TABLE "ProviderUsage" ADD COLUMN "inputTokens" INTEGER,
ADD COLUMN "outputTokens" INTEGER,
ADD COLUMN "model" TEXT;

CREATE INDEX "ProviderUsage_provider_createdAt_idx" ON "ProviderUsage"("provider", "createdAt");
