import { createHash } from "node:crypto";
import { db } from "../db";
import { pagesOf, project } from "../pro/data";
import { gscPeriod } from "../gsc-period";
import { groupTasks } from "../task-groups";
import { ISSUE_VERIFY } from "../audit/fixes";
import { buildPlan, profileOf, type Plan } from "./plan";
import {
  ADVICE_SCHEMA,
  SYSTEM,
  promptFor,
  validateSuggestions,
  applySuggestions,
} from "./ai";
import { llmProvider, llmStatus } from "../providers/llm";
import { env } from "../env";
import { assertBudget } from "../budget";
import { llmCost } from "../pricing";
import { jobLog } from "../jobctx";
import type { LLMProvider } from "../providers/types";
export type AdviceReport = Plan & {
  ai: {
    available: boolean;
    state: "ready" | "not_requested" | "unavailable" | "disabled" | "error";
    at: string | null;
  };
  permissions?: { manage: boolean; analyze: boolean };
  fingerprint: string;
};
export async function measuredPlan(id: string): Promise<Plan> {
  const [{ crawl, pages }, p, period, latestGa4, performance] =
    await Promise.all([
      pagesOf(id),
      project(id),
      gscPeriod(id),
      db.ga4Row.findFirst({
        where: { projectId: id },
        orderBy: { date: "desc" },
        select: { date: true },
      }),
      db.psiResult.count({ where: { projectId: id } }),
    ]);
  const [tasks, impressions] = await Promise.all([
    db.projectTask.findMany({
      where: {
        projectId: id,
        status: { in: ["detected", "pending", "reappeared"] },
        OR: [
          { source: { not: "crawl" } },
          { lastCrawlId: crawl?.id ?? "no-public-crawl" },
        ],
      },
      orderBy: [{ priority: "desc" }, { id: "asc" }],
      take: 3000,
    }),
    period
      ? db.gscRow.groupBy({
          by: ["page"],
          where: {
            projectId: id,
            date: { gte: period.start, lt: period.endExclusive },
          },
          _sum: { impressions: true },
        })
      : [],
  ]);
  const groups = groupTasks(
    tasks,
    new Set(),
    new Map(impressions.map((r) => [r.page, r._sum.impressions ?? 0])),
  );
  const plan = buildPlan({
    profile: profileOf((p.settings as any)?.advice),
    pages,
    groups,
    crawlAt: crawl?.startedAt.toISOString() ?? null,
    partial:
      crawl?.status === "partial" ||
      Boolean((crawl?.stats as any)?.limitReached),
    gsc: Boolean(period),
    analytics: Boolean(latestGa4),
    performance: performance > 0,
    period: period
      ? `${period.start.toISOString().slice(0, 10)} a ${period.end.toISOString().slice(0, 10)}`
      : null,
    taskSampleLimited: tasks.length === 3000,
    verify: ISSUE_VERIFY,
  });
  if (crawl && Date.now() - crawl.startedAt.getTime() > 28 * 864e5)
    plan.notes.push(
      "La auditoría tiene más de 28 días: actualízala antes de decidir cambios.",
    );
  if (latestGa4 && Date.now() - latestGa4.date.getTime() > 14 * 864e5)
    plan.notes.push(
      `Analytics no está actualizado: el último día guardado es ${latestGa4.date.toISOString().slice(0, 10)}.`,
    );
  if (period && Date.now() - period.end.getTime() > 14 * 864e5)
    plan.notes.push(
      "Los datos de Search Console tienen más de 14 días: sincroniza para decidir con datos recientes.",
    );
  return plan;
}
export function fingerprint(plan: Plan) {
  return createHash("sha256")
    .update(
      JSON.stringify({ plan, provider: env.llmProvider, model: env.llmModel }),
    )
    .digest("hex");
}
async function cached(id: string, hash: string) {
  return db.proSnapshot.findFirst({
    where: {
      projectId: id,
      kind: "advice-ai",
      source: { path: ["fingerprint"], equals: hash },
      createdAt: { gte: new Date(Date.now() - 864e5) },
    },
    orderBy: { createdAt: "desc" },
  });
}
export async function adviceReport(id: string): Promise<AdviceReport> {
  let plan = await measuredPlan(id);
  const hash = fingerprint(plan),
    available = llmStatus().available;
  let state: AdviceReport["ai"]["state"] = !plan.profile.aiEnabled
      ? "disabled"
      : !available
        ? "unavailable"
        : "not_requested",
    at: string | null = null;
  if (available && plan.profile.aiEnabled) {
    const cache = await cached(id, hash);
    if (cache) {
      at = cache.createdAt.toISOString();
      try {
        const data = cache.data as any;
        if (data.status === "ready") {
          plan = applySuggestions(plan, validateSuggestions(data.output, plan));
          state = "ready";
        } else state = "error";
      } catch {
        state = "error";
      }
    }
  }
  return { ...plan, ai: { available, state, at }, fingerprint: hash };
}
/** Separada del IO para probar respuestas inválidas sin usar claves ni enviar datos a un proveedor real. */
export async function explainPlan(plan: Plan, provider: LLMProvider) {
  const raw = await provider.json<unknown>(
    SYSTEM,
    promptFor(plan),
    3000,
    "low",
    ADVICE_SCHEMA,
  );
  return validateSuggestions(raw, plan);
}
export async function generateAdvice(
  id: string,
  providerOverride?: LLMProvider,
) {
  const plan = await measuredPlan(id),
    hash = fingerprint(plan),
    provider = providerOverride ?? llmProvider();
  if (!plan.profile.aiEnabled || !provider || !plan.actions.length)
    return {
      status: "skipped",
      reason: !plan.profile.aiEnabled
        ? "desactivada"
        : !provider
          ? "explicaciones con IA no disponibles en esta instalación"
          : "sin acciones que explicar",
    };
  const cache = await cached(id, hash);
  if (
    cache &&
    ((cache.data as any).status === "ready" ||
      Date.now() - cache.createdAt.getTime() < 5 * 60e3)
  )
    return { status: "reused" };
  const prompt = promptFor(plan);
  await assertBudget(
    {
      llm: llmCost(
        env.llmModel,
        Buffer.byteLength(
          SYSTEM + prompt + JSON.stringify(ADVICE_SCHEMA.schema),
          "utf8",
        ) + 256,
        3000,
      ),
    },
    "Explicación de acciones SEO",
  );
  let data: Record<string, unknown>;
  let status = "ready";
  try {
    const suggestions = await explainPlan(plan, provider);
    data = { status, output: { recommendations: suggestions } };
  } catch (e) {
    status = "fallback";
    data = { status: "error" };
    await jobLog(
      "warn",
      "No se pudo validar la explicación de IA; se conservan las acciones medidas",
      { error: e instanceof Error ? e.message : String(e) },
    );
  }
  await db.proSnapshot.create({
    data: {
      projectId: id,
      kind: "advice-ai",
      source: {
        fingerprint: hash,
        provider: env.llmProvider,
        model: env.llmModel,
      },
      data: JSON.parse(JSON.stringify(data)),
    },
  });
  const old = await db.proSnapshot.findMany({
    where: { projectId: id, kind: "advice-ai" },
    orderBy: { createdAt: "desc" },
    skip: 20,
    select: { id: true },
  });
  if (old.length)
    await db.proSnapshot.deleteMany({
      where: { projectId: id, id: { in: old.map((s) => s.id) } },
    });
  return { status };
}
