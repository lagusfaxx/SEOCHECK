import { db } from "./db";

export type CostCtx = { projectId?: string; ref?: string };

/** Registra unidades facturables. Nunca rompe el flujo si falla el insert. */
export async function logCost(provider: string, endpoint: string, units: number, ctx: CostCtx = {}, costUsd: number | null = null) {
  if (!process.env.DATABASE_URL) return; // scripts sin base de datos
  await db.apiCall.create({ data: { provider, endpoint, units, costUsd, projectId: ctx.projectId ?? null, ref: ctx.ref?.slice(0, 300) ?? null } }).catch((e) => console.warn("[costs]", e));
}
