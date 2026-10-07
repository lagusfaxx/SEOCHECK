import { db } from "@/lib/db";
import { budgetLimits, monthStart, spentThisMonth, type BudgetProvider } from "@/lib/budget";
import { providerStates } from "@/lib/volume/state";

export const dynamic = "force-dynamic";

/** Gasto del mes por proveedor vs. límite (presupuesto global, no por proyecto). */
export async function GET() {
  const limits = budgetLimits();
  const spent = await spentThisMonth();
  const since = monthStart();
  const daily = await db.$queryRaw<{ d: Date; provider: string; usd: number }[]>`
    SELECT date_trunc('day', "createdAt") AS d, provider, COALESCE(SUM("costUsd"), 0)::float AS usd
    FROM "ProviderUsage" WHERE "createdAt" >= ${since} GROUP BY 1, 2 ORDER BY 1`;
  const providers = (Object.keys(limits) as BudgetProvider[]).map((p) => {
    const s = spent.get(p);
    return { provider: p, limitUsd: limits[p], spentUsd: s?.usd ?? 0, calls: s?.calls ?? 0, units: s?.units ?? 0, inputTokens: s?.inputTokens ?? 0, outputTokens: s?.outputTokens ?? 0 };
  });
  return Response.json({ since, providers, daily, states: await providerStates() });
}
