import { db } from "@/lib/db";
import { budgetLimits, monthStart, type BudgetProvider } from "@/lib/budget";
import { providerStates } from "@/lib/volume/state";
import { isInstanceAdmin, userFromRequest } from "@/lib/auth";
import { providerHealth } from "@/lib/providers/health";

export const dynamic = "force-dynamic";

/** Gasto del mes por proveedor y estado de las APIs: solo para el dueño/admin de la instancia. */
export async function GET(req: Request) {
  const u = await userFromRequest(req);
  if (!u) return Response.json({ error: "Inicia sesión" }, { status: 401 });
  if (!(await isInstanceAdmin(u.id))) return Response.json({ error: "no existe" }, { status: 404 });
  const since = monthStart();
  const limits = budgetLimits();
  const rows = await db.providerUsage.groupBy({ by: ["provider"], where: { createdAt: { gte: since } }, _sum: { costUsd: true, units: true, inputTokens: true, outputTokens: true }, _count: true });
  const spent = new Map(rows.map((r) => [r.provider, r]));
  const daily = await db.$queryRaw<{ d: Date; provider: string; usd: number }[]>`
    SELECT date_trunc('day', "createdAt") AS d, provider, COALESCE(SUM("costUsd"), 0)::float AS usd
    FROM "ProviderUsage" WHERE "createdAt" >= ${since} GROUP BY 1, 2 ORDER BY 1`;
  const providers = (Object.keys(limits) as BudgetProvider[]).map((p) => {
    const s = spent.get(p);
    return {
      provider: p,
      limitUsd: limits[p],
      spentUsd: s?._sum.costUsd ?? 0,
      calls: s?._count ?? 0,
      units: s?._sum.units ?? 0,
      inputTokens: s?._sum.inputTokens ?? 0,
      outputTokens: s?._sum.outputTokens ?? 0,
    };
  });
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  return Response.json({ since, scope: "instance", providers, daily, states: await providerStates(), health: await providerHealth({ fresh }) });
}
