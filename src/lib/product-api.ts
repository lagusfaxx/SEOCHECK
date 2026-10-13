import { runInlineJob } from "./inline-job";
import { buildReport } from "./report";
import { billingConfig, createCheckout, billingPortal } from "./billing";
import { fetchPage } from "./audit/crawler";
import { contentText } from "./content/clean";
import { hostOf, normUrl, normTerm } from "./util";
import { enqueue, QUEUES } from "./queue";
import { withProjectQuota, assertResource } from "./plans";
import { assertProviderUp } from "./providers/health";
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
  admin: boolean;
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
    const technical = url.searchParams.get("mode") === "technical";
    const snapshot = snapshotId ? await db.reportSnapshot.findFirstOrThrow({ where: { id: snapshotId, projectId: id } }) : null;
    const r = snapshotId
      ? (snapshot!.executive as unknown as Awaited<ReturnType<typeof executiveReport>>)
      : await executiveReport(id);
    // Branding entitlement is evaluated at export time, including historical reports.
    const plan = await projectPlan(id);
    if (!plan.limits.whiteLabel) r.branding = {};
    const markdown = technical ? snapshot?.markdown ?? await buildReport(id) : undefined;
    return new Response(new Uint8Array(await executivePdf(r, markdown)), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="informe-seo-${technical ? "tecnico" : "ejecutivo"}.pdf"`,
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
  "costs/jobs": async ({ id, admin }) => {
    if (!admin) throw new ProductError(404, "no existe");
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
  "social/connection": async ({ id }) => {
    const { metaConfigured } = await import("./providers/meta");
    const c = await db.metaConnection.findUnique({ where: { projectId: id }, select: { igAccountId: true, igAccountName: true, tokenExpiresAt: true, lastError: true, createdAt: true } });
    const { igProfile } = await import("./providers/meta");
    const profile = c ? await igProfile(id).catch(() => null) : null;
    return { configured: metaConfigured(), connected: Boolean(c), igAccountName: profile?.username ?? c?.igAccountName ?? null, profile, tokenExpiresAt: c?.tokenExpiresAt ?? null, lastError: c?.lastError ?? null, connectedAt: c?.createdAt ?? null };
  },
  "social/posts": async ({ id, url }) => {
    const status = url.searchParams.get("status") ?? undefined;
    const posts = await db.socialPost.findMany({
      where: { projectId: id, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const ids = posts.map((p) => p.metaPostId).filter((x): x is string => Boolean(x));
    const stats = ids.length ? await db.igMedia.findMany({ where: { projectId: id, mediaId: { in: ids } }, select: { mediaId: true, reach: true, likes: true, comments: true, saved: true, shares: true, permalink: true } }) : [];
    const byId = new Map(stats.map((m) => [m.mediaId, m]));
    return posts.map((p) => ({ ...p, stats: (p.metaPostId && byId.get(p.metaPostId)) || null }));
  },
  "social/stats": async ({ id }) => {
    const { instagramStats } = await import("./social");
    return instagramStats(id);
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
    await assertProviderUp("serpent");
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

  // ---- Social / Meta ----
  "social/connect": async ({ id, user, url }) => {
    const origin = url.origin;
    const { startUrl } = await import("./providers/meta");
    const redirectUrl = await startUrl(id, user.id, origin);
    return { url: redirectUrl };
  },
  "social/generate-caption": async ({ id, body }) => {
    const { generateCaption } = await import("./social");
    const caption = await generateCaption(id, {
      context: typeof body.context === "string" ? body.context.slice(0, 500) : "",
      keywords: Array.isArray(body.keywords) ? (body.keywords as string[]).slice(0, 10) : [],
      tone: ["profesional", "cercano", "inspirador"].includes(body.tone) ? body.tone : "cercano",
    });
    return { caption };
  },
  "social/generate-image": async ({ id, body }) => {
    const { generateImage, decodeDataUrl } = await import("./social");
    const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 2000) : "";
    if (!prompt) throw invalid("Escribe un prompt para la imagen");
    const reference = body.reference ? decodeDataUrl(body.reference) : undefined;
    return generateImage(id, prompt, reference);
  },
  "social/upload-image": async ({ id, body }) => {
    const { saveImage, decodeDataUrl } = await import("./social");
    return { url: await saveImage(id, decodeDataUrl(body.image)) };
  },
  "social/posts": async ({ id, body }) => {
    const caption = typeof body.caption === "string" ? body.caption.trim().slice(0, 2200) : "";
    if (!caption) throw invalid("Escribe o genera un caption");
    const imageUrl = typeof body.imageUrl === "string" && body.imageUrl ? body.imageUrl.slice(0, 2000) : null;
    if (imageUrl) {
      const own = /^\/api\/social\/image\/([a-z0-9]+)$/.exec(imageUrl);
      if (own) {
        if (!(await db.socialImage.count({ where: { id: own[1], projectId: id } }))) throw invalid("Imagen no encontrada");
      } else if (!/^https:\/\//.test(imageUrl)) throw invalid("La imagen debe ser una URL https pública");
    }
    return db.socialPost.create({
      data: {
        projectId: id,
        caption,
        imageUrl,
        imagePrompt: typeof body.imagePrompt === "string" ? body.imagePrompt.slice(0, 2000) : null,
        keywords: Array.isArray(body.keywords) ? (body.keywords as unknown[]).filter((k): k is string => typeof k === "string").slice(0, 20) : [],
        status: "draft",
      },
    });
  },
  "social/publish": async ({ id, body }) => {
    const { publishPost } = await import("./social");
    const post = await db.socialPost.findFirst({ where: { projectId: id, id: boundedText(body.postId) } });
    if (!post) throw new ProductError(404, "no existe");
    if (!post.imageUrl) throw invalid("El post no tiene imagen");
    if (!(await publishPost(post.id, ["draft", "failed"]))) throw new ProductError(409, "Este post ya se está publicando o ya se publicó");
    return { ok: true };
  },
  "social/schedule": async ({ id, body }) => {
    const publishAt = new Date(body.scheduledAt);
    if (Number.isNaN(publishAt.getTime())) throw invalid("Fecha de programación inválida");
    if (publishAt < new Date(Date.now() + 60_000)) throw invalid("La fecha debe ser en el futuro");
    if (publishAt > new Date(Date.now() + 180 * 864e5)) throw invalid("Se puede programar hasta 6 meses adelante");
    const post = await db.socialPost.findFirst({ where: { projectId: id, id: boundedText(body.postId) } });
    if (!post) throw new ProductError(404, "no existe");
    if (!post.imageUrl) throw invalid("El post no tiene imagen");
    const { metaConfigured } = await import("./providers/meta");
    if (!metaConfigured() || !(await db.metaConnection.count({ where: { projectId: id } }))) throw invalid("Conecta Instagram antes de programar");
    const r = await db.socialPost.updateMany({ where: { id: post.id, status: { in: ["draft", "failed"] } }, data: { status: "scheduled", scheduledAt: publishAt, errorMsg: null } });
    if (!r.count) throw new ProductError(409, "Solo se pueden programar borradores o posts con error");
    return { ok: true };
  },
  "social/sync-stats": async ({ id }) => {
    const { syncInsights } = await import("./providers/meta");
    return syncInsights(id);
  },
  "social/unschedule": async ({ id, body }) => {
    const r = await db.socialPost.updateMany({ where: { projectId: id, id: boundedText(body.postId), status: "scheduled" }, data: { status: "draft", scheduledAt: null } });
    if (!r.count) throw new ProductError(409, "El post ya no está programado");
    return { ok: true };
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
    if (body.status === "resolved") {
      const task = await db.projectTask.findFirstOrThrow({ where: { projectId: id, id: boundedText(body.taskId) } });
      if (task.source === "crawl") throw invalid("Verifica la corrección con una nueva auditoría.");
    }
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
  "social/connection": async ({ id }) => {
    const { disconnect } = await import("./providers/meta");
    await disconnect(id);
    return { ok: true };
  },
  "social/posts": async ({ id, body }) => {
    const postId = boundedText(body.postId);
    await db.socialPost.deleteMany({ where: { projectId: id, id: postId, status: { in: ["draft", "failed", "scheduled"] } } });
    return { ok: true };
  },
};
