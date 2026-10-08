-- Preserve historical creation dates and give existing workspaces a 14-day migration grace period.
ALTER TABLE "Workspace" ADD COLUMN "trialEndsAt" TIMESTAMP(3) NOT NULL DEFAULT (now() + interval '14 days');
-- Prior completed/attempted work counts toward quotas, even if subsequently deleted.
INSERT INTO "QuotaUsage" (id, "workspaceId", resource, amount, "createdAt")
SELECT 'legacy-brief-' || c.id, p."workspaceId", 'briefs', 1, c."createdAt"
FROM "ContentAnalysis" c JOIN "Project" p ON p.id=c."projectId";
INSERT INTO "QuotaUsage" (id, "workspaceId", resource, amount, "createdAt")
SELECT 'legacy-report-' || r.id, p."workspaceId", 'reports', 1, r."createdAt"
FROM "ReportSnapshot" r JOIN "Project" p ON p.id=r."projectId";
