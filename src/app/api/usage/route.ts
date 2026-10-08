import { db } from "@/lib/db";
import { budgetLimits, monthStart, type BudgetProvider } from "@/lib/budget";
import { providerStates } from "@/lib/volume/state";
import { userFromRequest, userWorkspaceIds } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Gasto del mes por proveedor. El dueño de la instancia (workspace "trusted") ve el total contra los límites;
 * cualquier otro usuario ve solo lo que gastaron sus proyectos, sin los límites de la instancia.
 */
export async function GET(req: Request) {
  const u = await userFromRequest(req);
  if (!u) return Response.json({ error: "Inicia sesión" }, { status: 401 });
  const instanceAdmin = Boolean(await db.membership.findFirst({ where: { userId: u.id, role: { in: ["owner", "admin"] }, workspace: { trusted: true } } }));
  const projectIds = instanceAdmin ? null : (await db.project.findMany({ where: { workspaceId: { in: await userWorkspaceIds(u.id) } }, select: { id: true } })).map((p) => p.id);
  const since = monthStart();
  const scope = projectIds ? { projectId: { in: projectIds } } : {};
  const limits = budgetLimits();
  const rows = await db.providerUsage.groupBy({ by: ["provider"], where: { createdAt: { gte: since }, ...scope }, _sum: { costUsd: true, units: true, inputTokens: true, outputTokens: true }, _count: true });
  const spent = new Map(rows.map((r) => [r.provider, r]));
  const daily = projectIds
    ? await db.$queryRaw<{ d: Date; provider: string; usd: number }[]>`
      SELECT date_trunc('day', "createdAt") AS d, provider, COALESCE(SUM("costUsd"), 0)::float AS usd
      FROM "ProviderUsage" WHERE "createdAt" >= ${since} AND "projectId" = ANY(${projectIds}) GROUP BY 1, 2 ORDER BY 1`
    : await db.$queryRaw<{ d: Date; provider: string; usd: number }[]>`
      SELECT date_trunc('day', "createdAt") AS d, provider, COALESCE(SUM("costUsd"), 0)::float AS usd
      FROM "ProviderUsage" WHERE "createdAt" >= ${since} GROUP BY 1, 2 ORDER BY 1`;
  const providers = (Object.keys(limits) as BudgetProvider[]).map((p) => {
    const s = spent.get(p);
    return {
      provider: p,
      // -1 = sin límite visible para este usuario
      limitUsd: instanceAdmin ? limits[p] : -1,
      spentUsd: s?._sum.costUsd ?? 0,
      calls: s?._count ?? 0,
      units: s?._sum.units ?? 0,
      inputTokens: s?._sum.inputTokens ?? 0,
      outputTokens: s?._sum.outputTokens ?? 0,
    };
  });
  return Response.json({ since, scope: instanceAdmin ? "instance" : "workspace", providers, daily, states: instanceAdmin ? await providerStates() : [] });
}
