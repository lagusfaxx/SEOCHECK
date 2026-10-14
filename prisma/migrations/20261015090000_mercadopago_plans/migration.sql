-- Plan FSV Search por perfil con Mercado Pago y prueba de 7 días
ALTER TABLE "Workspace" ALTER COLUMN "trialEndsAt" SET DEFAULT (now() + '7 days'::interval);
ALTER TABLE "Workspace" ADD COLUMN "seats" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Workspace" ADD COLUMN "mpPreapprovalId" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "mpStatus" TEXT;
CREATE UNIQUE INDEX "Workspace_mpPreapprovalId_key" ON "Workspace"("mpPreapprovalId");
ALTER TABLE "BillingOrder" ADD COLUMN "seats" INTEGER NOT NULL DEFAULT 1;
