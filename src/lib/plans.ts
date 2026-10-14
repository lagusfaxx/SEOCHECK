import { db } from "./db";

/** Recursos con cupo. images/ai/research gastan tokens de OpenAI y búsquedas pagadas, por eso tienen cupo mensual. */
export const QUOTA_RESOURCES = ["keywords", "rankings", "briefs", "reports", "images", "ai", "research"] as const;
export type QuotaResource = (typeof QUOTA_RESOURCES)[number];
/** Se cuentan en QuotaUsage (por mes UTC; durante la prueba, por toda la prueba). keywords y rankings se cuentan por lo guardado. */
const METERED: readonly QuotaResource[] = ["briefs", "reports", "images", "ai", "research"];

export type Limits = {
  label: string;
  projects: number;
  urls: number;
  keywords: number;
  rankings: number;
  briefs: number;
  reports: number;
  /** imágenes generadas con IA */
  images: number;
  /** textos con IA: captions y secciones de brief regeneradas */
  ai: number;
  /** investigaciones de keywords */
  research: number;
  whiteLabel: boolean;
};

export const TRIAL_DAYS = 7;
/** Precio por perfil (proyecto) al mes, en CLP. Se puede cambiar con PLAN_PRICE_CLP sin tocar código. */
export const planPriceClp = () => {
  const v = Number(process.env.PLAN_PRICE_CLP);
  return Number.isInteger(v) && v > 0 ? v : 9990;
};
export const MAX_SEATS = 20;

export const PLANS = {
  /** Mientras BILLING_ENABLED no sea "true": cuentas gratis sin vencimiento, con cupo mensual moderado (cuida el gasto en APIs). */
  beta: { label: "Beta gratuita", projects: 2, urls: 500, keywords: 500, rankings: 50, briefs: 10, reports: 5, images: 20, ai: 60, research: 6, whiteLabel: false },
  /** 7 días gratis al registrarse, sin tarjeta y con cupo bajo: alcanza para probar cada herramienta. */
  trial: { label: `Prueba gratis (${TRIAL_DAYS} días)`, projects: 1, urls: 100, keywords: 100, rankings: 10, briefs: 2, reports: 1, images: 3, ai: 15, research: 2, whiteLabel: false },
  /** Plan pagado: cupos por perfil (proyecto); se multiplican por los perfiles contratados (Workspace.seats). */
  pro: { label: "FSV Search", projects: 1, urls: 1000, keywords: 500, rankings: 50, briefs: 8, reports: 4, images: 30, ai: 100, research: 6, whiteLabel: false },
  /** Planes anteriores: siguen funcionando para quien los tenga asignados, pero ya no se venden. */
  seo: { label: "SEO", projects: 3, urls: 2000, keywords: 2000, rankings: 200, briefs: 30, reports: 10, images: 60, ai: 200, research: 15, whiteLabel: false },
  agency: { label: "Agencia", projects: 20, urls: 10000, keywords: 10000, rankings: 2000, briefs: 200, reports: 100, images: 300, ai: 1000, research: 80, whiteLabel: true },
} as const satisfies Record<string, Limits>;
export type PlanKey = keyof typeof PLANS;

/** Cobro activo. Apagado: nadie ve precios ni checkout y la prueba pasa a ser la beta gratuita. */
export const billingEnabled = () => process.env.BILLING_ENABLED === "true";

/**
 * Workspace dueño de la instancia (`trusted`, creado en /setup): uso interno, sin límites de plan ni vencimiento.
 * Fuera de PLANS a propósito: no se ofrece ni se puede contratar.
 */
export const INTERNAL_PLAN: Limits = {
  label: "Interno",
  projects: 1_000_000,
  urls: 50_000,
  keywords: 1_000_000,
  rankings: 1_000_000,
  briefs: 1_000_000,
  reports: 1_000_000,
  images: 1_000_000,
  ai: 1_000_000,
  research: 1_000_000,
  whiteLabel: true,
};

/** Límites del plan pagado para n perfiles: todo escala por perfil salvo las páginas por auditoría. */
export function proLimits(seats: number): Limits {
  const n = Math.min(MAX_SEATS, Math.max(1, Math.floor(seats) || 1));
  const b = PLANS.pro;
  return { ...b, label: n === 1 ? b.label : `${b.label} · ${n} perfiles`, projects: n, keywords: b.keywords * n, rankings: b.rankings * n, briefs: b.briefs * n, reports: b.reports * n, images: b.images * n, ai: b.ai * n, research: b.research * n };
}

/** Plan efectivo de un workspace: un solo lugar para límites y vencimiento. */
export function resolvePlan(w: { plan: string; trusted: boolean; trialEndsAt: Date; planValidUntil: Date | null; seats?: number }): { key: PlanKey | "internal"; limits: Limits; expired: boolean } {
  if (w.trusted) return { key: "internal", limits: INTERNAL_PLAN, expired: false };
  let key: PlanKey = isPlan(w.plan) ? w.plan : "trial";
  if (!billingEnabled()) {
    // sin cobro nada vence: la prueba es la beta y los planes asignados a mano no caducan
    if (key === "trial") key = "beta";
    return { key, limits: key === "pro" ? proLimits(w.seats ?? 1) : PLANS[key], expired: false };
  }
  if (key === "beta") return { key, limits: PLANS.beta, expired: false };
  const expired = key === "trial" ? Date.now() > w.trialEndsAt.getTime() : !!w.planValidUntil && Date.now() > w.planValidUntil.getTime();
  return { key, limits: key === "pro" ? proLimits(w.seats ?? 1) : PLANS[key], expired };
}
export class PlanLimitError extends Error {
  status = 402;
}
export const isPlan = (v: unknown): v is PlanKey =>
  typeof v === "string" && Object.hasOwn(PLANS, v);
export async function workspacePlan(workspaceId: string) {
  const w = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });
  return { workspace: w, ...resolvePlan(w) };
}
export async function projectPlan(projectId: string) {
  const p = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { workspaceId: true },
  });
  return workspacePlan(p.workspaceId);
}
const expiredMessage = (key: string) =>
  key === "trial"
    ? `Terminaron tus ${TRIAL_DAYS} días gratis. Activa FSV Search en Ajustes → Plan para seguir creando trabajos; tus datos siguen disponibles.`
    : "Tu plan no está vigente: revisa el pago en Ajustes → Plan. Tus datos siguen disponibles.";

export async function assertPlanActive(projectId: string) {
  const p = await projectPlan(projectId);
  if (p.expired) throw new PlanLimitError(expiredMessage(p.key));
  return p;
}

type Tx = import("@prisma/client").Prisma.TransactionClient;
const monthStart = () => {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  return since;
};
/** Uso actual de un recurso: lo guardado (keywords, rankings) o lo consumido en el periodo (mes UTC; la prueba completa). */
async function usageOf(tx: Tx, w: { id: string }, key: string, resource: QuotaResource) {
  const where = { project: { workspaceId: w.id } };
  if (resource === "keywords") return tx.keyword.count({ where });
  if (resource === "rankings") return tx.trackedKeyword.count({ where: { ...where, active: true } });
  const r = await tx.quotaUsage.aggregate({
    where: { workspaceId: w.id, resource, ...(key !== "trial" ? { createdAt: { gte: monthStart() } } : {}) },
    _sum: { amount: true },
  });
  return r._sum.amount ?? 0;
}
/** Uso de todos los recursos del workspace, para los medidores de Ajustes → Plan. */
export async function workspaceUsage(workspaceId: string, key: string) {
  const out = { projects: await db.project.count({ where: { workspaceId } }) } as Record<QuotaResource | "projects", number>;
  for (const r of QUOTA_RESOURCES) out[r] = await usageOf(db, { id: workspaceId }, key, r);
  return out;
}

const NAMES: Record<QuotaResource, string> = {
  keywords: "keywords",
  rankings: "keywords en seguimiento",
  briefs: "briefs del mes",
  reports: "informes del mes",
  images: "imágenes con IA del mes",
  ai: "textos con IA del mes",
  research: "investigaciones de keywords del mes",
};
const limitMessage = (resource: QuotaResource, current: number, p: { key: string; limits: Limits }) => {
  const name = p.key === "trial" ? NAMES[resource].replace(" del mes", " de la prueba") : NAMES[resource];
  const tail = !billingEnabled()
    ? "Escríbenos a contacto@fsvc.cl si necesitas más."
    : p.key === "trial"
      ? "Activa FSV Search en Ajustes → Plan para tener más."
      : "Suma otro perfil en Ajustes → Plan o espera al próximo mes.";
  return `Llegaste al límite de ${name} de tu plan (${current}/${p.limits[resource]}). ${tail}`;
};

export async function assertResource(projectId: string, resource: QuotaResource, extra: number) {
  const p = await assertPlanActive(projectId);
  const current = await usageOf(db, p.workspace, p.key, resource);
  if (current + extra > p.limits[resource]) throw new PlanLimitError(limitMessage(resource, current, p));
  return p;
}

/** Descuenta n usos de un recurso medido (images, ai, research…) antes de gastar en el proveedor. */
export async function consumeQuota(projectId: string, resource: QuotaResource, n = 1) {
  return withProjectQuota(projectId, resource, n, async (tx) => (await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { workspaceId: true } })).workspaceId);
}
/** Devuelve el cupo si el proveedor falló: un error nuestro no debe gastar el plan. */
export async function refundQuota(workspaceId: string, resource: QuotaResource, n = 1) {
  await db.quotaUsage.create({ data: { workspaceId, resource, amount: -n } });
}
/** Corre fn con un uso descontado y lo devuelve si falla. */
export async function withQuota<T>(projectId: string, resource: QuotaResource, fn: () => Promise<T>) {
  const workspaceId = await consumeQuota(projectId, resource, 1);
  try {
    return await fn();
  } catch (e) {
    await refundQuota(workspaceId, resource, 1).catch(() => {});
    throw e;
  }
}
/**
 * Devuelve el cupo de brief de análisis que fallaron (API caída, worker reiniciado…): un fallo
 * nuestro no debe gastar el plan. Idempotente por análisis; el reembolso lleva la fecha del
 * análisis para que caiga en el mismo mes del cupo que consumió.
 */
export async function refundBriefs(contentIds: string[]) {
  for (const id of contentIds) {
    await db.$transaction(async (tx) => {
      const r = await tx.contentAnalysis.updateMany({ where: { id, quotaRefunded: false }, data: { quotaRefunded: true } });
      if (!r.count) return;
      const a = await tx.contentAnalysis.findUniqueOrThrow({ where: { id }, select: { createdAt: true, project: { select: { workspaceId: true } } } });
      await tx.quotaUsage.create({ data: { workspaceId: a.project.workspaceId, resource: "briefs", amount: -1, createdAt: a.createdAt } });
    });
  }
}
export async function crawlLimit(projectId: string, requested: number) {
  const p = await assertPlanActive(projectId);
  return Math.min(Math.max(1, Math.floor(requested) || 500), p.limits.urls);
}

/** Serialize resource creation per workspace so two requests cannot both use the last slot. */
export async function withProjectQuota<T>(
  projectId: string,
  resource: QuotaResource,
  extra: number | ((tx: Tx) => Promise<number>),
  create: (tx: Tx) => Promise<T>,
) {
  return db.$transaction(
    async (tx) => {
      const p = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { workspaceId: true } });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p.workspaceId}))`;
      const w = await tx.workspace.findUniqueOrThrow({ where: { id: p.workspaceId } });
      const plan = resolvePlan(w);
      const count = await usageOf(tx, w, plan.key, resource);
      const needed = typeof extra === "number" ? extra : await extra(tx);
      if (plan.expired || count + needed > plan.limits[resource]) {
        if (resource === "reports" && needed === 1 && w.reportCredits > 0)
          await tx.workspace.update({ where: { id: w.id }, data: { reportCredits: { decrement: 1 } } });
        else throw new PlanLimitError(plan.expired ? expiredMessage(plan.key) : limitMessage(resource, count, plan));
      }
      const result = await create(tx);
      if (METERED.includes(resource) && needed > 0) await tx.quotaUsage.create({ data: { workspaceId: w.id, resource, amount: needed } });
      return result;
    },
    { timeout: 60000 },
  );
}
export async function createProjectWithinPlan(
  workspaceId: string,
  data: import("@prisma/client").Prisma.ProjectUncheckedCreateInput,
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
    const w = await tx.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
    });
    const { limits, expired } = resolvePlan(w);
    if (expired) throw new PlanLimitError(expiredMessage(resolvePlan(w).key));
    if ((await tx.project.count({ where: { workspaceId } })) >= limits.projects)
      throw new PlanLimitError(
        `Tu plan incluye ${limits.projects} ${limits.projects === 1 ? "perfil" : "perfiles"} (${limits.label}).${billingEnabled() ? " Suma otro perfil en Ajustes → Plan." : ""}`,
      );
    return tx.project.create({ data });
  });
}
