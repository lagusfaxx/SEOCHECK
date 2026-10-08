import { runInlineJob } from "./inline-job";
import { billingConfig, createCheckout, billingPortal } from "./billing";
import { fetchPage } from "./audit/crawler";
import { contentText } from "./content/clean";
import { hostOf, normUrl, normTerm } from "./util";
import { enqueue, QUEUES } from "./queue";
import { withProjectQuota, assertResource } from "./plans";
import { gscAvailable } from "./providers/google";
import { TYPE_LABEL } from "./graph-types";
import { db } from "./db";
import { requireWorkspace } from "./auth";
import { projectActions, setTaskStatus, setTaskGroupStatus } from "./tasks";
import { TASK_STATUSES, type TaskStatus } from "./task-rules";
import {
  auditComparison,
  executivePdf,
  executiveReport,
  issueCsv,
  nextReportAt,
  saveReport,
} from "./reporting";
import { PLANS, projectPlan, PlanLimitError } from "./plans";
import { clusterInsights, rankOpportunities } from "./keyword-insights";
import {
  BRIEF_SECTIONS,
  compareImplementation,
  implementationMarkdown,
  regenerateSection,
  storeBrief,
  validateBrief,
  type BriefSection,
} from "./content/brief-tools";
import type { Brief, ContentResult } from "./content/analyze";
import { assertBudget, est, releaseBudget } from "./budget";

type Ctx = {
  id: string;
  url: URL;
  body: any;
  user: { id: string; email: string };
};
type Handler = (c: Ctx) => Promise<unknown>;
export class ProductError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const invalid = (message: string) => new ProductError(400, message);
async function ownContent(id: string, cid: unknown) {
  if (typeof cid !== "string") throw invalid("Falta el análisis");
  return db.contentAnalysis.findFirstOrThrow({
    where: { id: cid, projectId: id },
    include: { project: true },
  });
}
async function admin(id: string, userId: string) {
  const p = await db.project.findUniqueOrThrow({
    where: { id },
    select: { workspaceId: true },
  });
  await requireWorkspace(userId, p.workspaceId, "admin");
  return p.workspaceId;
}
function boundedText(v: unknown, max = 200) {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw invalid("Texto vacío o demasiado largo");
  return v.trim();
}
export const PRODUCT_GETS: Record<string, Handler> = {
  "billing/config": async () => billingConfig(),
  onboarding: async ({ id }) => {
    const [p, mode, crawl, keywords, rankings, report] = await Promise.all([
      db.project.findUniqueOrThrow({ where: { id } }),
      gscAvailable(id),
      db.crawl.count({
        where: { projectId: id, status: { in: ["completed", "partial"] } },
      }),
      db.keyword.count({ where: { projectId: id } }),
      db.trackedKeyword.count({ where: { projectId: id, active: true } }),
      db.reportSnapshot.count({ where: { projectId: id } }),
    ]);
    const s = p.settings as any;
    return {
      experience: s.onboarding?.experience ?? "beginner",
      skipGsc: s.onboarding?.skipGsc ?? s.onboarding?.skipped?.includes("gsc") ?? false,
      completed: {
        gsc: !!p.gscProperty && !!mode,
        crawl: !!crawl,
        keywords: !!keywords,
        rankings: !!rankings,
        report: !!report,
      },
    };
  },
  tasks: async ({ id }) => projectActions(id),
  "audit/comparison": async ({ id }) => auditComparison(id),
  "report/executive": async ({ id }) => executiveReport(id),
  "report/pdf": async ({ id, url }) => {
    const snapshotId = url.searchParams.get("snapshot");
    const r = snapshotId
      ? ((
          await db.reportSnapshot.findFirstOrThrow({
            where: { id: snapshotId, projectId: id },
          })
        ).executive as unknown as Awaited<ReturnType<typeof executiveReport>>)
      : await executiveReport(id);
    // Branding entitlement is evaluated at export time, including historical reports.
    const plan = await projectPlan(id);
    if (!plan.limits.whiteLabel) r.branding = {};
    return new Response(new Uint8Array(await executivePdf(r)), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="informe-seo.pdf"',
      },
    });
  },
  "report/csv": async ({ id }) =>
    new Response(await issueCsv(id), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="incidencias-seo.csv"',
      },
    }),
  "report/history": async ({ id }) =>
    db.reportSnapshot.findMany({
      where: { projectId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, createdAt: true, executive: true },
    }),
  "report/snapshot": async ({ id, url }) => {
    const r = await db.reportSnapshot.findFirstOrThrow({
      where: { id: url.searchParams.get("snapshot") ?? "", projectId: id },
    });
    return new Response(r.markdown, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": 'attachment; filename="informe-tecnico.md"',
      },
    });
  },
  "report/schedule": async ({ id }) =>
    db.reportSchedule.findUnique({ where: { projectId: id } }),
  "keywords/insights": async ({ id, url }) =>
    clusterInsights(id, url.searchParams.get("run") ?? undefined),
  "rank/opportunities": async ({ id }) => rankOpportunities(id),
  explorations: async ({ id }) =>
    db.exploration.findMany({
      where: { projectId: id },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, updatedAt: true },
    }),
  "explorations/one": async ({ id, url }) =>
    db.exploration.findFirstOrThrow({
      where: { id: url.searchParams.get("eid") ?? "", projectId: id },
    }),
  "content/versions": async ({ id, url }) => {
    const a = await ownContent(id, url.searchParams.get("cid"));
    return db.briefVersion.findMany({
      where: { contentId: a.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  },
  "content/implementation": async ({ id, url }) => {
    const a = await ownContent(id, url.searchParams.get("cid"));
    return new Response(implementationMarkdown(a), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": 'attachment; filename="implementar-brief.md"',
      },
    });
  },
  plan: async ({ id }) => {
    const p = await projectPlan(id);
    return {
      plan: p.key,
      limits: p.limits,
      expired: p.expired,
      reportCredits: p.workspace.reportCredits,
      trialEndsAt: p.workspace.trialEndsAt,
      plans: PLANS,
      branding: p.limits.whiteLabel ? p.workspace.branding : {},
    };
  },
  "costs/jobs": async ({ id }) => {
    const jobs = await db.jobRun.findMany({
      where: { projectId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const costs = await db.providerUsage.groupBy({
      by: ["jobRunId"],
      where: { projectId: id, jobRunId: { in: jobs.map((j) => j.id) } },
      _sum: { costUsd: true },
      _count: true,
    });
    const map = new Map(costs.map((c) => [c.jobRunId, c]));
    const rows = jobs.map((j) => ({
      ...j,
      costUsd: map.get(j.id) ? map.get(j.id)!._sum.costUsd : null,
      calls: map.get(j.id) ? map.get(j.id)!._count : 0,
    }));
    return {
      jobs: rows,
      byKind: [...new Set(rows.map((j) => j.kind))].map((kind) => ({
        kind,
        jobs: rows.filter((j) => j.kind === kind).length,
        costUsd: rows
          .filter((j) => j.kind === kind)
          .reduce((sum, j) => sum + (j.costUsd ?? 0), 0),
      })),
      note: "Sin llamadas registradas no se estima costo. El total incluye proveedores externos; no incluye infraestructura.",
    };
  },
};
export const PRODUCT_POSTS: Record<string, Handler> = {
  "billing/checkout": async ({ id, user, body }) =>
    createCheckout(id, user, body.product),
  "billing/portal": async ({ id, user }) => billingPortal(id, user.id),
  "content/cluster": async ({ id, body }) => {
    const c = await db.cluster.findFirstOrThrow({
      where: { id: body.clusterId, projectId: id },
    });
    const p = await db.project.findUniqueOrThrow({ where: { id } });
    const url = normUrl(String(body.url ?? ""));
    if (
      !url ||
      !(
        hostOf(url) === hostOf(p.domain) ||
        hostOf(url).endsWith(`.${hostOf(p.domain)}`)
      )
    )
      throw invalid("Elige una URL del proyecto");
    await assertResource(id, "briefs", 1);
    await assertBudget(
      { serpent: est.serpCalls(1), llm: est.llmBrief() },
      "Brief del cluster",
    );
    const a = await withProjectQuota(id, "briefs", 1, (tx) =>
      tx.contentAnalysis.create({
        data: { projectId: id, url, keyword: normTerm(c.primary) },
      }),
    );
    await enqueue(id, QUEUES.content, { contentId: a.id }, a.id);
    return a;
  },
  "content/competitor": async ({ id, body }) => {
    const p = await db.project.findUniqueOrThrow({ where: { id } }),
      ownUrl = normUrl(String(body.ownUrl ?? "")),
      competitorUrl = normUrl(String(body.competitorUrl ?? ""));
    if (
      !ownUrl ||
      !competitorUrl ||
      !(
        hostOf(ownUrl) === hostOf(p.domain) ||
        hostOf(ownUrl).endsWith(`.${hostOf(p.domain)}`)
      )
    )
      throw invalid("La página propia debe pertenecer al proyecto");
    const [own, competitor] = await Promise.all([
      fetchPage(ownUrl),
      fetchPage(competitorUrl),
    ]);
    if ([own, competitor].some((p) => p.status !== 200 || p.error))
      throw invalid(
        "No se pudieron leer ambas páginas. Comprueba su acceso público.",
      );
    const measured = (p: typeof own) => ({
      url: p.finalUrl ?? p.url,
      title: p.title,
      headings: p.headings,
      words: contentText(p, new Set()).split(/\s+/).length,
      schema: p.jsonldTypes,
    });
    return {
      fetchedAt: new Date().toISOString(),
      own: measured(own),
      competitor: measured(competitor),
    };
  },
  tasks: async ({ id, body, user }) => {
    const title = boundedText(body.title),
      reason = boundedText(
        body.reason ?? "Tarea creada desde el proyecto.",
        2000,
      );
    return db.projectTask.create({
      data: {
        projectId: id,
        fingerprint: `manual:${crypto.randomUUID()}`,
        title,
        reason,
        url: typeof body.url === "string" ? body.url.slice(0, 2048) : null,
        source: "manual",
        status: "pending",
        category:
          body.category === "opportunity" ? "opportunity" : "improvement",
        priority: 1,
        events: { create: { status: "pending", actor: user.id } },
      },
    });
  },
  "report/save": async ({ id }) => saveReport(id),
  explorations: async ({ id, body }) => {
    const name = boundedText(body.name, 100),
      graph = body.graph;
    if (
      !graph ||
      !Array.isArray(graph.nodes) ||
      !Array.isArray(graph.edges) ||
      graph.nodes.length > 1000 ||
      graph.edges.length > 5000 ||
      JSON.stringify(graph).length > 2000000
    )
      throw invalid("Exploración inválida o demasiado grande");
    for (const n of graph.nodes)
      if (
        typeof n.id !== "string" ||
        !n.position ||
        !Number.isFinite(n.position.x) ||
        !Number.isFinite(n.position.y) ||
        !n.data ||
        typeof n.data.label !== "string" ||
        typeof n.data.key !== "string" ||
        !Object.hasOwn(TYPE_LABEL,n.data.type) ||
        (n.data.url && !/^https?:\/\//.test(n.data.url))
      )
        throw invalid("Nodo inválido");
    const nodeIds = new Set(graph.nodes.map((n: any) => n.id));
    if (
      graph.edges.some(
        (e: any) =>
          !e ||
          typeof e.source !== "string" ||
          typeof e.target !== "string" ||
          !nodeIds.has(e.source) ||
          !nodeIds.has(e.target),
      )
    )
      throw invalid("Arista inválida");
    if (body.eid) {
      await db.exploration.findFirstOrThrow({
        where: { id: body.eid, projectId: id },
      });
      return db.exploration.update({
        where: { id: body.eid },
        data: { name, graph },
      });
    }
    return db.exploration.create({ data: { projectId: id, name, graph } });
  },
  "content/section": async ({ id, body, user }) => {
    const a = await ownContent(id, body.cid);
    if(a.status!=="done")throw new ProductError(409,"Espera a que termine el análisis");
    if (!BRIEF_SECTIONS.includes(body.section))
      throw invalid("Sección inválida");
    const brief = await runInlineJob(id, "content.section", async () => {
      await assertBudget({ llm: est.llmBrief() }, "Regenerar sección");
      return regenerateSection(
        a.result as unknown as ContentResult,
        a.brief as unknown as Brief,
        body.section as BriefSection,
        a.project.language,
        a.project.country,
      );
    });
    return storeBrief(a.id, brief, `section:${body.section}`, user.id);
  },
  "content/restore": async ({ id, body, user }) => {
    const a = await ownContent(id, body.cid);
    const version = await db.briefVersion.findFirstOrThrow({
      where: { id: body.versionId, contentId: a.id },
    });
    return storeBrief(
      a.id,
      version.brief as unknown as Brief,
      "restore",
      user.id,
    );
  },
  "content/compare": async ({ id, body }) => {
    const a = await ownContent(id, body.cid);
    return compareImplementation(a.url, a.brief as unknown as Brief);
  },
};
export const PRODUCT_PATCHS: Record<string, Handler> = {
  onboarding: async ({ id, body }) => {
    const p = await db.project.findUniqueOrThrow({ where: { id } }),
      s = p.settings as any;
    const onboarding = { ...(s.onboarding ?? {}) };
    if (body.experience != null) {
      if (!["beginner", "seo", "agency"].includes(body.experience))
        throw invalid("Experiencia inválida");
      onboarding.experience = body.experience;
    }
    if (typeof body.skipGsc === "boolean") {
      onboarding.skipGsc = body.skipGsc;
      onboarding.skipped = [...new Set([
        ...(onboarding.skipped ?? []).filter((step: string) => step !== "gsc"),
        ...(body.skipGsc ? ["gsc"] : []),
      ])];
    }
    return db.project.update({
      where: { id },
      data: { settings: { ...s, onboarding } },
    });
  },
  tasks: async ({ id, body, user }) => {
    if (!TASK_STATUSES.includes(body.status)) throw invalid("Estado inválido");
    return body.group === true
      ? setTaskGroupStatus(
          id,
          boundedText(body.taskId),
          body.status as TaskStatus,
          user.id,
        )
      : setTaskStatus(
          id,
          boundedText(body.taskId),
          body.status as TaskStatus,
          user.id,
        );
  },
  "report/schedule": async ({ id, body, user }) => {
    await admin(id, user.id);
    if (!["weekly", "monthly"].includes(body.frequency))
      throw invalid("Frecuencia inválida");
    return db.reportSchedule.upsert({
      where: { projectId: id },
      create: {
        projectId: id,
        frequency: body.frequency,
        nextAt: nextReportAt(body.frequency),
        enabled: body.enabled !== false,
      },
      update: {
        frequency: body.frequency,
        nextAt: nextReportAt(body.frequency),
        enabled: body.enabled !== false,
      },
    });
  },
  branding: async ({ id, body, user }) => {
    const wid = await admin(id, user.id),
      plan = await projectPlan(id);
    if (!plan.limits.whiteLabel)
      throw new PlanLimitError("White-label está disponible solo en Agencia");
    const name = boundedText(body.name, 100),
      contact =
        typeof body.contact === "string" ? body.contact.slice(0, 500) : "";
    if (!/^#[0-9a-f]{6}$/i.test(body.color)) throw invalid("Color inválido");
    const logo = body.logo ?? "";
    if (
      typeof logo !== "string" ||
      logo.length > 500000 ||
      (logo && !/^data:image\/(png|jpeg);base64,[a-zA-Z0-9+/=]+$/.test(logo))
    )
      throw invalid("Logo: usa PNG/JPEG de hasta 350 KB");
    return db.workspace.update({
      where: { id: wid },
      data: { branding: { name, contact, color: body.color, logo } },
    });
  },
};
export const PRODUCT_DELETES: Record<string, Handler> = {
  explorations: async ({ id, body }) =>
    db.exploration.deleteMany({
      where: { projectId: id, id: boundedText(body.eid) },
    }),
};
