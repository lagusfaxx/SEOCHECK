-- AlterTable
ALTER TABLE "ContentAnalysis" ADD COLUMN "quotaRefunded" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: los análisis que ya fallaron devuelven el cupo de brief que consumieron
INSERT INTO "QuotaUsage" ("id", "workspaceId", "resource", "amount", "createdAt")
SELECT gen_random_uuid()::text, p."workspaceId", 'briefs', -1, a."createdAt"
FROM "ContentAnalysis" a JOIN "Project" p ON p."id" = a."projectId"
WHERE a."status" = 'error';

UPDATE "ContentAnalysis" SET "quotaRefunded" = true WHERE "status" = 'error';
