import { db } from "./db";

export type CostCtx = { projectId?: string; ref?: string };

/** Registra unidades facturables. Nunca rompe el flujo si falla el insert. */
export async function logCost(provider: string, endpoint: string, units: number, ctx: CostCtx = {}) {
  await db.apiCall.create({ data: { provider, endpoint, units, projectId: ctx.projectId ?? null, ref: ctx.ref?.slice(0, 300) ?? null } }).catch((e) => console.warn("[costs]", e));
}
