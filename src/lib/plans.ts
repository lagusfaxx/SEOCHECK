import { db } from "./db";

export const PLANS = {
  trial: {
    label: "Prueba (14 días)",
    projects: 1,
    urls: 200,
    keywords: 200,
    rankings: 20,
    briefs: 3,
    reports: 2,
    whiteLabel: false,
  },
  seo: {
    label: "SEO",
    projects: 3,
    urls: 2000,
    keywords: 2000,
    rankings: 200,
    briefs: 30,
    reports: 10,
    whiteLabel: false,
  },
  agency: {
    label: "Agencia",
    projects: 20,
    urls: 10000,
    keywords: 10000,
    rankings: 2000,
    briefs: 200,
    reports: 100,
    whiteLabel: true,
  },
} as const;
export type PlanKey = keyof typeof PLANS;

/**
 * Workspace dueño de la instancia (`trusted`, creado en /setup): uso interno, sin límites de plan ni vencimiento.
 * Fuera de PLANS a propósito: no se ofrece ni se puede contratar.
 */
export const INTERNAL_PLAN = {
  label: "Interno",
  projects: 1_000_000,
  urls: 50_000,
  keywords: 1_000_000,
  rankings: 1_000_000,
  briefs: 1_000_000,
  reports: 1_000_000,
  whiteLabel: true,
} as const;
type Limits = (typeof PLANS)[PlanKey] | typeof INTERNAL_PLAN;

/** Plan efectivo de un workspace: un solo lugar para límites y vencimiento. */
export function resolvePlan(w: { plan: string; trusted: boolean; trialEndsAt: Date; planValidUntil: Date | null }): { key: PlanKey | "internal"; limits: Limits; expired: boolean } {
  if (w.trusted) return { key: "internal", limits: INTERNAL_PLAN, expired: false };
  const key = isPlan(w.plan) ? w.plan : "trial";
  const expired = key === "trial" ? Date.now() > w.trialEndsAt.getTime() : !!w.planValidUntil && Date.now() > w.planValidUntil.getTime();
  return { key, limits: PLANS[key], expired };
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
export async function assertPlanActive(projectId: string) {
  const p = await projectPlan(projectId);
  if (p.expired)
    throw new PlanLimitError(
      "La prueba de 14 días terminó. Elige un plan para crear nuevos trabajos; tus datos siguen disponibles.",
    );
  return p;
}
export async function assertResource(
  projectId: string,
  resource: "keywords" | "rankings" | "briefs" | "reports",
  extra: number,
) {
  const p = await assertPlanActive(projectId);
  const where = { project: { workspaceId: p.workspace.id } };
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  const current =
    resource === "keywords"
      ? await db.keyword.count({ where })
      : resource === "rankings"
        ? await db.trackedKeyword.count({ where: { ...where, active: true } })
        : ((
            await db.quotaUsage.aggregate({
              where: {
                workspaceId: p.workspace.id,
                resource,
                ...(p.key !== "trial" ? { createdAt: { gte: since } } : {}),
              },
              _sum: { amount: true },
            })
          )._sum.amount ?? 0);
  if (current + extra > p.limits[resource])
    throw new PlanLimitError(
      `Límite de ${resource} del plan ${p.limits.label}: ${current}/${p.limits[resource]}. Reduce la selección o cambia de plan.`,
    );
  return p;
}
export async function crawlLimit(projectId: string, requested: number) {
  const p = await assertPlanActive(projectId);
  return Math.min(Math.max(1, Math.floor(requested) || 500), p.limits.urls);
}

/** Serialize resource creation per workspace so two requests cannot both use the last slot. */
export async function withProjectQuota<T>(
  projectId: string,
  resource: "keywords" | "rankings" | "briefs" | "reports",
  extra:
    | number
    | ((
        tx: import("@prisma/client").Prisma.TransactionClient,
      ) => Promise<number>),
  create: (tx: import("@prisma/client").Prisma.TransactionClient) => Promise<T>,
) {
  return db.$transaction(
    async (tx) => {
      const p = await tx.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { workspaceId: true },
      });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p.workspaceId}))`;
      const w = await tx.workspace.findUniqueOrThrow({
        where: { id: p.workspaceId },
      });
      const { key, limits, expired } = resolvePlan(w);
      const since = new Date();
      since.setUTCDate(1);
      since.setUTCHours(0, 0, 0, 0);
      const where = { project: { workspaceId: w.id } };
      const count =
        resource === "keywords"
          ? await tx.keyword.count({ where })
          : resource === "rankings"
            ? await tx.trackedKeyword.count({
                where: { ...where, active: true },
              })
            : ((
                await tx.quotaUsage.aggregate({
                  where: {
                    workspaceId: w.id,
                    resource,
                    ...(key !== "trial" ? { createdAt: { gte: since } } : {}),
                  },
                  _sum: { amount: true },
                })
              )._sum.amount ?? 0);
      const needed = typeof extra === "number" ? extra : await extra(tx);
      if (expired || count + needed > limits[resource]) {
        if (resource === "reports" && needed === 1 && w.reportCredits > 0)
          await tx.workspace.update({
            where: { id: w.id },
            data: { reportCredits: { decrement: 1 } },
          });
        else
          throw new PlanLimitError(
            expired
              ? "La vigencia del plan terminó. Tus datos permanecen disponibles."
              : `Límite de ${resource}: ${count}/${limits[resource]}.`,
          );
      }
      const result = await create(tx);
      if ((resource === "briefs" || resource === "reports") && needed > 0)
        await tx.quotaUsage.create({
          data: { workspaceId: w.id, resource, amount: needed },
        });
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
    if (expired) throw new PlanLimitError("El plan expiró");
    if ((await tx.project.count({ where: { workspaceId } })) >= limits.projects)
      throw new PlanLimitError(
        `Límite de ${limits.projects} ${limits.projects === 1 ? "proyecto" : "proyectos"} del plan ${limits.label}`,
      );
    return tx.project.create({ data });
  });
}
