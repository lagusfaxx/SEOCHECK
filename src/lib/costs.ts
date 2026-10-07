import { db } from "./db";
import { currentProjectId } from "./jobctx";

export type CostCtx = { projectId?: string; ref?: string };

export type Usage = {
  provider: string;
  endpoint: string;
  units?: number;
  costUsd?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  model?: string | null;
} & CostCtx;

/** Registra uso en ProviderUsage. Nunca rompe el flujo si falla el insert. */
export async function logUsage(u: Usage) {
  if (!process.env.DATABASE_URL) return; // scripts sin base de datos
  await db.providerUsage
    .create({
      data: {
        provider: u.provider, endpoint: u.endpoint, units: u.units ?? 1, costUsd: u.costUsd ?? null,
        inputTokens: u.inputTokens ?? null, outputTokens: u.outputTokens ?? null, model: u.model ?? null,
        projectId: u.projectId ?? currentProjectId() ?? null, ref: u.ref?.slice(0, 300) ?? null,
      },
    })
    .catch((e) => console.warn("[usage]", e));
}

/** Compatibilidad: unidades + costo opcional. */
export async function logCost(provider: string, endpoint: string, units: number, ctx: CostCtx = {}, costUsd: number | null = null) {
  await logUsage({ provider, endpoint, units, costUsd, ...ctx });
}
