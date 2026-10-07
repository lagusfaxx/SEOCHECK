import { db } from "./db";
import { env } from "./env";
import { llmCost, SERPENT_USD_PER_CALL } from "./pricing";

/**
 * Presupuesto mensual por proveedor (USD). Se compara el gasto del mes (ProviderUsage.costUsd, mes
 * calendario en TZ) + la estimación máxima del job ANTES de llamar a la API: si no cabe, el job falla
 * sin gastar nada. Un límite negativo = sin límite.
 */
export type BudgetProvider = "serpent" | "dataforseo" | "apify" | "llm";

const num = (v: string | undefined, d: number) => (v == null || v === "" ? d : Number(v));
export function budgetLimits(): Record<BudgetProvider, number> {
  return {
    serpent: num(process.env.SERPENT_MONTHLY_USD, 3),
    dataforseo: num(process.env.DATAFORSEO_MONTHLY_USD, 1),
    apify: num(process.env.APIFY_MONTHLY_USD, 0),
    llm: num(process.env.LLM_MONTHLY_USD, 2),
  };
}

/** Costo estimado por task de DataForSEO search volume (el real llega en `cost` de la respuesta). */
export const DFS_USD_PER_TASK = Number(process.env.DATAFORSEO_USD_PER_TASK ?? 0.075);

/** Inicio del mes calendario actual en la zona horaria configurada. */
export function monthStart(now = new Date(), tz = env.tz): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit" }).formatToParts(now).map((p) => [p.type, p.value]));
  const guess = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, 1));
  const off = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(guess).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = off.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  const minutes = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
  return new Date(guess.getTime() - minutes * 60_000);
}

export async function spentThisMonth(provider?: BudgetProvider) {
  const rows = await db.providerUsage.groupBy({
    by: ["provider"],
    where: { createdAt: { gte: monthStart() }, ...(provider ? { provider } : {}) },
    _sum: { costUsd: true, units: true, inputTokens: true, outputTokens: true },
    _count: true,
  });
  return new Map(rows.map((r) => [r.provider, { usd: r._sum.costUsd ?? 0, calls: r._count, units: r._sum.units ?? 0, inputTokens: r._sum.inputTokens ?? 0, outputTokens: r._sum.outputTokens ?? 0 }]));
}

export class BudgetError extends Error {
  constructor(public details: { provider: BudgetProvider; limit: number; spent: number; needed: number }[], label: string) {
    const nextMonth = new Date(monthStart().getTime() + 32 * 864e5);
    super(
      `${label}: presupuesto mensual insuficiente — ` +
        details
          .map((d) => `${d.provider}: gastado $${d.spent.toFixed(4)} de $${d.limit.toFixed(2)}, este job necesita hasta $${d.needed.toFixed(4)} (sube ${d.provider === "llm" ? "LLM" : d.provider.toUpperCase()}_MONTHLY_USD)`)
          .join("; ") +
        `. No se llamó a ninguna API. Se renueva el ${monthStart(nextMonth).toISOString().slice(0, 10)}.`
    );
    this.name = "BudgetError";
  }
}

/** Lanza BudgetError si alguna estimación no cabe en lo que queda del mes. */
export async function assertBudget(estimates: Partial<Record<BudgetProvider, number>>, label: string) {
  const limits = budgetLimits();
  const spent = await spentThisMonth();
  const over = (Object.entries(estimates) as [BudgetProvider, number][])
    .filter(([p, need]) => need > 0 && limits[p] >= 0 && (spent.get(p)?.usd ?? 0) + need > limits[p] + 1e-9)
    .map(([p, need]) => ({ provider: p, limit: limits[p], spent: spent.get(p)?.usd ?? 0, needed: need }));
  if (over.length) throw new BudgetError(over, label);
}

/** ¿Cabe este gasto? (sin lanzar) — para saltar un proveedor de volumen y pasar al siguiente. */
export async function fitsBudget(provider: BudgetProvider, need: number) {
  const limit = budgetLimits()[provider];
  if (limit < 0 || need <= 0) return true;
  const spent = (await spentThisMonth(provider)).get(provider)?.usd ?? 0;
  return spent + need <= limit + 1e-9;
}

// ---- Estimaciones (cotas superiores) ----
const llmOn = () => (env.llmProvider === "anthropic" ? Boolean(env.anthropicKey) : Boolean(env.openaiKey));

export const est = {
  serpCalls: (n: number) => (env.serpentKey ? n * SERPENT_USD_PER_CALL : 0),
  /** intent: lotes de 200 keywords (~3k tokens entrada, ~2.5k salida) */
  llmIntent: (keywords: number) => (llmOn() ? Math.ceil(keywords / 200) * llmCost(env.llmModel, 3000, 2500) : 0),
  /** brief: ~8k entrada, hasta 16k salida */
  llmBrief: () => (llmOn() ? llmCost(env.llmModel, 8000, 16000) : 0),
};
