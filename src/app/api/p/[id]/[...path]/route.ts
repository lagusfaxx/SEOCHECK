import { BriefValidationError } from "@/lib/content/claims";
import { runInlineJob } from "@/lib/inline-job";
import { BillingError } from "@/lib/billing";
import { PRODUCT_GETS, PRODUCT_POSTS, PRODUCT_PATCHS, PRODUCT_DELETES, ProductError } from "@/lib/product-api";
import { withProjectQuota, assertResource, crawlLimit, PlanLimitError, projectPlan } from "@/lib/plans";
import { storeBrief, validateBrief } from "@/lib/content/brief-tools";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { cancelJob, enqueue, QUEUES } from "@/lib/queue";
import { AuthError, memLimit, requireProject, requireUser } from "@/lib/auth";
import { sweepStale, workerAlive } from "@/lib/jobs";
import { refreshCluster } from "@/lib/keywords/pipeline";
import { ISSUE_LABELS } from "@/lib/audit/issues";
import { auditInsights } from "@/lib/audit/insights-data";
import { coverage, shortLabel } from "@/lib/coverage";
import { onboarding } from "@/lib/onboarding";
import { gscAvailable, gscSites, indexNow, resolveGscProperty } from "@/lib/providers/google";
import { disconnect, GscNotConnected, oauthConfigured, startUrl } from "@/lib/gsc-oauth";
import { gscTargetFor, makeBrief, type ContentResult } from "@/lib/content/analyze";
import { parseKeywordPlannerCsv } from "@/lib/volume/csv";
import { backfillVolumes, volumeChainStatus, writeCache } from "@/lib/volume/broker";
import { env } from "@/lib/env";
import { llmStatus } from "@/lib/providers/llm";
import { assertBudget, BudgetError, budgetLimits, est, monthStart, releaseBudget, spentThisMonth } from "@/lib/budget";
import { hostOf, normTerm, normUrl } from "@/lib/util";
import { buildReport } from "@/lib/report";
import { expand, graphSearch, siteNode } from "@/lib/graph";
import { TRANSFORMS, type GType } from "@/lib/graph-types";

export const dynamic = "force-dynamic";

type Ctx = { id: string; path: string[]; url: URL; body: any; user: { id: string; email: string } };
type H = (c: Ctx) => Promise<unknown>;

const ok = (data: unknown) => Response.json(data ?? { ok: true });

/** Error con status HTTP (404 para no revelar que el recurso existe en otro proyecto). */
class HttpError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}
const notFound = () => new HttpError(404, "no existe");

/** Aislamiento: todo id que llega por parámetro tiene que ser de ESTE proyecto. */
async function ownCrawl(projectId: string, crawlId: string | null) {
  if (!crawlId) throw notFound();
  const c = await db.crawl.findFirst({ where: { id: crawlId, projectId }, select: { id: true } });
  if (!c) throw notFound();
  return c.id;
}
async function ownContent(projectId: string, cid: string | null | undefined) {
  if (!cid) throw notFound();
  const a = await db.contentAnalysis.findFirst({ where: { id: cid, projectId }, include: { project: true } });
  if (!a) throw notFound();
  return a;
}
async function ownOptional(model: "keywordRun" | "topic" | "cluster", projectId: string, id: string | null | undefined) {
  if (id == null) return null;
  const row = await (db[model] as any).findFirst({ where: { id, projectId }, select: { id: true } });
  if (!row) throw notFound();
  return row.id as string;
}
/** Evita trabajos duplicados (doble clic, dos pestañas): uno del mismo tipo a la vez por proyecto. */
async function assertIdle(projectId: string, kind: string, label: string) {
  const busy = await db.jobRun.findFirst({ where: { projectId, kind, status: { in: ["queued", "running"] } }, select: { id: true } });
  if (busy) throw new HttpError(409, `Ya hay ${label} en curso: espera a que termine o cancélalo`);
}

/** URLs que el usuario manda (crawl, PageSpeed, contenido, IndexNow): solo del dominio del proyecto o sus subdominios. */
async function ownUrls(projectId: string, urls: string[]) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { domain: true } });
  const site = hostOf(`https://${p.domain}`);
  const out: string[] = [];
  for (const raw of urls) {
    const u = normUrl(String(raw ?? ""));
    if (!u) continue;
    const h = hostOf(u);
    if (h !== site && !h.endsWith(`.${site}`)) throw new HttpError(400, `La URL ${u} no es del dominio del proyecto (${site})`);
    out.push(u);
  }
  return out;
}
const bad = (msg: string, status = 400) => Response.json({ error: msg }, { status });

/** Serie diaria de Search Console: totales del sitio (GscDay) o, si aún no se sincronizan, la suma de GscRow. */
async function gscSeries(projectId: string, since: Date) {
  const days = await db.gscDay.findMany({ where: { projectId, date: { gte: since } }, orderBy: { date: "asc" } });
  if (days.length) return days.map((r) => ({ d: r.date, clicks: r.clicks, impressions: r.impressions, position: r.position }));
  return db.$queryRaw<{ d: Date; clicks: number; impressions: number; position: number }[]>`
    SELECT date AS d, SUM(clicks)::int AS clicks, SUM(impressions)::int AS impressions,
      SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
    FROM "GscRow" WHERE "projectId" = ${projectId} AND date >= ${since} GROUP BY date ORDER BY date`;
}

const GETS: Record<string, H> = {
  ...PRODUCT_GETS,
  "": async ({ id }) => {
    const p = await db.project.findUniqueOrThrow({ where: { id } });
    const chain = await volumeChainStatus();
    return {
      ...p,
      volumeChain: chain,
      providers: {
        serp: Boolean(env.serpentKey), volume: chain.find((c) => c.available)?.provider ?? false, embeddings: env.embeddingsUrl ? "local" : env.openaiKey ? "openai" : "hash",
        llm: llmStatus().available ? `${env.llmProvider}:${env.llmModel}` : false, gsc: await gscAvailable(id), psi: Boolean(env.psiKey), render: Boolean(env.browserWs), indexnow: Boolean(env.indexNowKey),
      },
    };
  },

  jobs: async ({ id }) => {
    await sweepStale(id);
    const [jobs, alive] = await Promise.all([
      db.jobRun.findMany({
        where: { projectId: id, OR: [{ status: { in: ["queued", "running"] } }, { updatedAt: { gte: new Date(Date.now() - 10 * 60_000) } }] },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, kind: true, status: true, progress: true, message: true, createdAt: true, updatedAt: true },
      }),
      workerAlive(),
    ]);
    // en cola sin worker vivo: que se note en vez de quedar "en cola" para siempre
    return jobs.map((j) => (j.status === "queued" && !alive ? { ...j, message: "El worker no responde: revisa el servicio worker en Coolify" } : j));
  },

  overview: async ({ id }) => {
    const [kw, clusters, crawl, tracked, alerts, gsc, content] = await Promise.all([
      db.keyword.aggregate({ where: { projectId: id, excluded: false }, _count: true, _sum: { volume: true } }),
      db.cluster.count({ where: { projectId: id } }),
      db.crawl.findFirst({ where: { projectId: id, status: { in: ["completed", "partial"] } }, orderBy: { startedAt: "desc" } }),
      db.trackedKeyword.findMany({ where: { projectId: id, active: true }, include: { checks: { orderBy: { date: "desc" }, take: 2 } } }),
      db.alert.findMany({ where: { projectId: id, seen: false }, orderBy: { createdAt: "desc" }, take: 20 }),
      gscSeries(id, new Date(Date.now() - 90 * 864e5)),
      db.contentAnalysis.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, keyword: true, score: true, status: true } }),
    ]);
    const pos = tracked.map((t) => t.checks[0]?.position).filter((x): x is number => x != null);
    return {
      keywords: kw._count, volume: kw._sum.volume ?? 0, clusters,
      crawl: crawl ? { id: crawl.id, stats: crawl.stats, at: crawl.finishedAt } : null,
      tracked: tracked.length,
      avgPos: pos.length ? pos.reduce((a, b) => a + b, 0) / pos.length : null,
      top3: pos.filter((p) => p <= 3).length, top10: pos.filter((p) => p <= 10).length,
      movers: tracked
        .map((t) => ({ keyword: t.keyword, pos: t.checks[0]?.position ?? null, prev: t.checks[1]?.position ?? null }))
        .filter((m) => m.prev != null || m.pos != null)
        .sort((a, b) => Math.abs((b.prev ?? 101) - (b.pos ?? 101)) - Math.abs((a.prev ?? 101) - (a.pos ?? 101)))
        .slice(0, 8),
      alerts, gsc, content,
    };
  },

  keywords: async ({ id, url }) => {
    const runs = await db.keywordRun.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: 20 });
    const runId = url.searchParams.get("run") ?? runs[0]?.id;
    const scope = runId ? { projectId: id, runId } : { projectId: id };
    const [keywords, clusters, topics, tracked] = await Promise.all([
      db.keyword.findMany({ where: scope, select: { id: true, term: true, sources: true, relevance: true, volume: true, volumeMin: true, volumeMax: true, volumeSource: true, volumeAt: true, cpc: true, competition: true, intent: true, difficulty: true, score: true, excluded: true, locked: true, clusterId: true }, orderBy: [{ score: { sort: "desc", nulls: "last" } }] }),
      db.cluster.findMany({ where: scope, orderBy: { volume: "desc" } }),
      db.topic.findMany({ where: scope }),
      db.trackedKeyword.findMany({ where: { projectId: id }, select: { keyword: true } }),
    ]);
    return { runs, runId, keywords, clusters, topics, tracked: tracked.map((t) => t.keyword) };
  },

  audit: async ({ id, url }) => {
    const crawls = await db.crawl.findMany({ where: { projectId: id }, orderBy: { startedAt: "desc" }, take: 10, select: { id: true, status: true, reason: true, stats: true, startedAt: true, finishedAt: true, options: true, sitemapUrls: true } });
    const asked = url.searchParams.get("crawl");
    const crawlId = asked ? await ownCrawl(id, asked) : crawls[0]?.id;
    if (!crawlId) return { crawls, crawlId: null };
    const [byCode, pages, psi, inspections] = await Promise.all([
      db.issue.groupBy({ by: ["code", "severity"], where: { crawlId }, _count: true }),
      db.page.findMany({
        where: { crawlId },
        select: { id: true, url: true, status: true, titleLen: true, metaLen: true, wordCount: true, depth: true, inlinks: true, outlinks: true, responseMs: true, canonicalType: true, noindex: true, inSitemap: true, orphan: true, jsonldTypes: true, imgNoAlt: true, title: true },
        orderBy: [{ depth: "asc" }, { url: "asc" }],
        take: 5000,
      }),
      db.psiResult.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: 40 }),
      db.urlInspection.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
    ]);
    const issueCounts = await db.issue.groupBy({ by: ["url"], where: { crawlId }, _count: true });
    const cnt = new Map(issueCounts.map((i) => [i.url, i._count]));
    return {
      crawls, crawlId,
      issues: byCode.map((g) => ({ code: g.code, label: ISSUE_LABELS[g.code] ?? g.code, severity: g.severity, count: g._count })),
      pages: pages.map((p) => ({ ...p, issues: cnt.get(p.url) ?? 0 })),
      psi, inspections,
    };
  },

  onboarding: async (ctx) => ({ ...(await onboarding(ctx.id)), ...(await PRODUCT_GETS.onboarding(ctx) as Record<string, unknown>) }),

  coverage: async ({ id }) => (await coverage(id)).map((m) => ({ ...m, short: shortLabel(m) })),

  /** Hallazgos priorizados: causa raíz por plantilla, tipo, prioridad por impacto y patrones. */
  "audit/insights": async ({ id, url }) => {
    const crawlId = await ownCrawl(id, url.searchParams.get("crawl"));
    const r = await auditInsights(id, crawlId);
    // el detalle de URLs va recortado: la lista completa está en la pestaña Issues / el anexo del informe
    return { ...r, findings: r.findings.map((f) => ({ ...f, total: f.urls.length, urls: f.urls.slice(0, 50) })) };
  },

  "audit/issue": async ({ id, url }) => {
    const crawlId = await ownCrawl(id, url.searchParams.get("crawl"));
    const code = url.searchParams.get("code")!;
    return db.issue.findMany({ where: { crawlId, code }, take: 2000 });
  },

  "audit/page": async ({ id, url }) => {
    const crawlId = await ownCrawl(id, url.searchParams.get("crawl"));
    const u = url.searchParams.get("url")!;
    const page = await db.page.findUnique({ where: { crawlId_url: { crawlId, url: u } } });
    const issues = await db.issue.findMany({ where: { crawlId, url: u } });
    const inbound = await db.page.findMany({ where: { crawlId, links: { has: u } }, select: { url: true }, take: 100 });
    return { page, issues: issues.map((i) => ({ ...i, label: ISSUE_LABELS[i.code] ?? i.code })), inbound: inbound.map((x) => x.url) };
  },

  rank: async ({ id, url }) => {
    const days = Number(url.searchParams.get("days") ?? 30);
    const since = new Date(Date.now() - days * 864e5);
    const tracked = await db.trackedKeyword.findMany({
      where: { projectId: id },
      include: { checks: { where: { date: { gte: since } }, orderBy: { date: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    const alerts = await db.alert.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: 100 });
    return { tracked, alerts };
  },

  gsc: async ({ id, url }) => {
    const days = Number(url.searchParams.get("days") ?? 28);
    const dim = url.searchParams.get("dim") === "page" ? "page" : "query";
    const q = url.searchParams.get("q") ?? "";
    const since = new Date(Date.now() - (days + 2) * 864e5);
    const prevSince = new Date(since.getTime() - days * 864e5);
    const like = `%${q}%`;
    const col = Prisma.raw(`"${dim}"`);
    const [rows, series, prev, count] = await Promise.all([
      db.$queryRaw<any[]>`
        SELECT ${col} AS key, SUM(clicks)::int AS clicks, SUM(impressions)::int AS impressions,
          CASE WHEN SUM(impressions) > 0 THEN SUM(clicks)::float / SUM(impressions) ELSE 0 END AS ctr,
          SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position, COUNT(DISTINCT ${Prisma.raw(dim === "page" ? '"query"' : '"page"')})::int AS n
        FROM "GscRow" WHERE "projectId" = ${id} AND date >= ${since} AND ${col} ILIKE ${like}
        GROUP BY ${col} ORDER BY clicks DESC, impressions DESC LIMIT 1000`,
      // sin filtro: totales reales del sitio (GscDay); con filtro: suma de las filas que calzan
      q
        ? db.$queryRaw<any[]>`
        SELECT date AS d, SUM(clicks)::int AS clicks, SUM(impressions)::int AS impressions,
          SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
        FROM "GscRow" WHERE "projectId" = ${id} AND date >= ${since} AND ${col} ILIKE ${like} GROUP BY date ORDER BY date`
        : gscSeries(id, since),
      db.$queryRaw<any[]>`
        SELECT ${col} AS key, SUM(clicks)::int AS clicks, SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS position
        FROM "GscRow" WHERE "projectId" = ${id} AND date >= ${prevSince} AND date < ${since} AND ${col} ILIKE ${like} GROUP BY ${col}`,
      db.gscRow.count({ where: { projectId: id } }),
    ]);
    const pm = new Map(prev.map((r) => [r.key, r]));
    return {
      total: count,
      rows: rows.map((r) => ({ ...r, prevClicks: pm.get(r.key)?.clicks ?? null, prevPosition: pm.get(r.key)?.position ?? null })),
      series,
    };
  },

  "gsc/detail": async ({ id, url }) => {
    const dim = url.searchParams.get("dim") === "page" ? "page" : "query";
    const key = url.searchParams.get("key")!;
    const days = Number(url.searchParams.get("days") ?? 28);
    const since = new Date(Date.now() - (days + 2) * 864e5);
    const other = dim === "page" ? "query" : "page";
    const rows = await db.gscRow.groupBy({
      by: [other],
      where: { projectId: id, date: { gte: since }, [dim]: key },
      _sum: { clicks: true, impressions: true },
      _avg: { position: true },
      orderBy: { _sum: { impressions: "desc" } },
      take: 200,
    });
    return rows.map((r: any) => ({ key: r[other], clicks: r._sum.clicks, impressions: r._sum.impressions, position: r._avg.position }));
  },

  costs: async ({ id, url }) => {
    const days = Number(url.searchParams.get("days") ?? 30);
    const since = new Date(Date.now() - days * 864e5);
    const [byEndpoint, recent] = await Promise.all([
      db.providerUsage.groupBy({ by: ["provider", "endpoint"], where: { projectId: id, createdAt: { gte: since } }, _sum: { units: true }, _count: true }),
      db.providerUsage.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: 200 }),
    ]);
    return { byEndpoint: byEndpoint.map((r) => ({ provider: r.provider, endpoint: r.endpoint, calls: r._count, units: r._sum.units ?? 0 })), recent };
  },

  content: async ({ id }) =>
    db.contentAnalysis.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, select: { id: true, url: true, keyword: true, score: true, status: true, createdAt: true } }),

  report: async ({ id, url }) => {
    const md = await buildReport(id);
    const p = await db.project.findUniqueOrThrow({ where: { id }, select: { domain: true } });
    const name = `seo-${p.domain.replace(/[^a-z0-9.-]/gi, "")}-${new Date().toISOString().slice(0, 10)}.md`;
    return new Response(md, {
      headers: { "content-type": "text/markdown; charset=utf-8", ...(url.searchParams.has("download") ? { "content-disposition": `attachment; filename="${name}"` } : {}) },
    });
  },
  "graph/root": async ({ id }) => siteNode((await db.project.findUniqueOrThrow({ where: { id }, select: { domain: true } })).domain),
  "graph/search": async ({ id, url }) => graphSearch(id, url.searchParams.get("q") ?? ""),
  "graph/expand": async ({ id, url }) => {
    const type = url.searchParams.get("type") as GType;
    const t = url.searchParams.get("t") ?? "";
    if (!Object.hasOwn(TRANSFORMS,type) || !TRANSFORMS[type]?.some((x) => x.id === t)) throw new Error("transformación inválida");
    return expand(id, type, url.searchParams.get("key") ?? "", t);
  },
  /** Estado de la conexión con Search Console del proyecto */
  "gsc/connection": async ({ id }) => {
    const [mode, c, p] = await Promise.all([
      gscAvailable(id),
      db.gscConnection.findUnique({ where: { projectId: id }, select: { googleEmail: true, lastError: true, createdAt: true } }),
      db.project.findUniqueOrThrow({ where: { id }, select: { gscProperty: true } }),
    ]);
    return { oauthConfigured: oauthConfigured(), mode, email: c?.googleEmail ?? null, lastError: c?.lastError ?? null, connectedAt: c?.createdAt ?? null, property: p.gscProperty };
  },
  /** Propiedades que ve la cuenta conectada (para elegir) */
  "gsc/sites": async ({ id }) => ((await gscAvailable(id)) ? gscSites(id) : []),
  "report/last": async ({ id }) => db.jobRun.findFirst({ where: { projectId: id, kind: QUEUES.full }, orderBy: { createdAt: "desc" } }),
  /** Para el formulario de Contenido: qué URL ya rankea para la keyword en Search Console. */
  "content/target": async ({ id, url }) => gscTargetFor(id, url.searchParams.get("keyword") ?? "", url.searchParams.get("url") || undefined),
  "content/one": async ({ id, url }) => {
    const { project: _p, ...a } = await ownContent(id, url.searchParams.get("cid"));
    return a;
  },
};

const POSTS: Record<string, H> = {
  ...PRODUCT_POSTS,
  "keywords/run": async ({ id, body }) => {
    const seeds: string[] = (body.seeds ?? []).map((s: string) => normTerm(s)).filter(Boolean);
    if (!seeds.length) throw new HttpError(400, "Escribe al menos una semilla");
    await assertIdle(id, QUEUES.keywords, "una investigación de keywords");
    await assertResource(id, "keywords", 0);
    const kwOpts = { serpTop: 150, serpExpansion: 20, maxKeywords: 400, ...((((await db.project.findUniqueOrThrow({ where: { id } })).settings ?? {}) as any).keywords ?? {}) };
    await assertBudget({ serpent: est.serpCalls(seeds.length + kwOpts.serpExpansion + kwOpts.serpTop), llm: est.llmIntent(kwOpts.maxKeywords) }, "Investigación de keywords");
    // volumeLive: DataForSEO endpoint Live (solo si se pide explícitamente); por defecto standard queue
    const run = await db.keywordRun.create({ data: { projectId: id, seeds, threshold: Number(body.threshold ?? 0.45), options: { volumeLive: body.volumeLive === true } } });
    await enqueue(id, QUEUES.keywords, { runId: run.id }, run.id);
    return run;
  },

  "keywords/rerun": async ({ id, body }) => {
    await assertResource(id, "keywords", 0);
    const run = await db.keywordRun.findFirstOrThrow({ where: { projectId: id, id: body.runId } });
    await db.keywordRun.update({ where: { id: run.id }, data: { status: "queued" } });
    return enqueue(id, QUEUES.keywords, { runId: run.id }, run.id);
  },

  "keywords/topic": async ({ id, body }) =>
    db.topic.create({ data: { projectId: id, runId: await ownOptional("keywordRun", id, body.runId), name: body.name ?? "nuevo topic", pos: body.pos, nameLocked: true } }),

  "keywords/cluster": async ({ id, body }) =>
    db.cluster.create({
      data: { projectId: id, runId: await ownOptional("keywordRun", id, body.runId), name: body.name ?? "nuevo cluster", primary: body.name ?? "", topicId: await ownOptional("topic", id, body.topicId) },
    }),

  audit: async ({ id, body }) => {
    await assertIdle(id, QUEUES.crawl, "un crawl");
    if (body.verification === true) {
      const previous = await db.crawl.findFirst({ where: { projectId: id, status: { in: ["completed", "partial"] } }, orderBy: { startedAt: "desc" } });
      body = { ...(previous?.options as object ?? {}), ...body };
    }
    const crawl = await db.crawl.create({
      data: {
        projectId: id,
        options: {
          maxPages: await crawlLimit(id, Number(body.maxPages ?? 500)),
          concurrency: Math.max(1, Math.min(Number(body.concurrency ?? 5) || 5, 20)),
          render: Boolean(body.render),
          startUrl: body.startUrl ? (await ownUrls(id, [body.startUrl]))[0] : undefined,
        },
      },
    });
    await enqueue(id, QUEUES.crawl, { crawlId: crawl.id }, crawl.id);
    return crawl;
  },

  /** Importa un CSV de Keyword Planner (body crudo, UTF-16/tab) como fuente de volumen `csv`. */
  "volumes/csv": async ({ id, body }) => {
    if (!Buffer.isBuffer(body) || !body.length) throw new Error("envía el archivo CSV como body (Content-Type: text/csv u octet-stream)");
    const p = await db.project.findUniqueOrThrow({ where: { id } });
    const { rows, skipped } = parseKeywordPlannerCsv(body);
    await writeCache(rows, p.country, p.language, "csv");
    const updated = await backfillVolumes(p.country, p.language, rows.map((r) => r.keyword));
    return { imported: rows.length, skipped, updated, withRange: rows.filter((r) => r.volumeMin !== r.volumeMax).length };
  },

  /** Corre todos los módulos en un solo job y deja los datos listos para el informe. */
  report: async ({ id, body }) => {
    const running = await db.jobRun.findFirst({ where: { projectId: id, kind: QUEUES.full, status: { in: ["queued", "running"] } } });
    if (running) throw new Error("ya hay un informe en curso");
    await assertResource(id,"reports",1);
    const opts = {
      maxPages: await crawlLimit(id, Number(body.maxPages ?? 1000)),
      concurrency: Math.min(Number(body.concurrency ?? 3), 10),
      render: Boolean(body.render),
      seeds: ((body.seeds ?? []) as string[]).map((s) => normTerm(s)).filter(Boolean).slice(0, 20),
      gsc: body.gsc !== false,
      inspect: body.inspect !== false,
      psi: body.psi !== false,
      rank: body.rank !== false,
    };
    return enqueue(id, QUEUES.full, { opts });
  },

  "audit/psi": async ({ id, body }) =>
    (await assertIdle(id, QUEUES.psi, "una medición de PageSpeed")) ??
    enqueue(id, QUEUES.psi, { urls: (await ownUrls(id, (body.urls ?? []).slice(0, 20))), strategies: (body.strategies ?? ["mobile", "desktop"]).filter((x: string) => x === "mobile" || x === "desktop") }),

  "audit/inspect": async ({ id, body }) => (await assertIdle(id, QUEUES.inspect, "una inspección")) ?? enqueue(id, QUEUES.inspect, { urls: await ownUrls(id, (body.urls ?? []).slice(0, 100)) }),

  indexnow: async ({ id, body }) => {
    const p = await db.project.findUniqueOrThrow({ where: { id } });
    const status = await indexNow(p.domain, await ownUrls(id, body.urls ?? []));
    return { status };
  },

  rank: async ({ id, body }) => {
    const kws: string[] = [...new Set<string>((body.keywords ?? []).map((k: string) => normTerm(k)).filter(Boolean))];
    // frecuencia: la del body, si no la del proyecto (settings.rank.frequency), si no semanal
    const projFreq = ((((await db.project.findUniqueOrThrow({ where: { id } })).settings ?? {}) as any).rank?.frequency as string) ?? "weekly";
    if (body.frequency != null && !["daily","weekly"].includes(body.frequency)) throw new HttpError(400,"Frecuencia inválida");
    const existing = await db.trackedKeyword.findMany({where:{projectId:id,keyword:{in:kws},active:true},select:{keyword:true}});
    await assertResource(id,"rankings",kws.length-existing.length);
    const created = await withProjectQuota(id,"rankings",async tx=>kws.length-await tx.trackedKeyword.count({where:{projectId:id,keyword:{in:kws},active:true}}),async tx=>{
    const created: any[] = [];
    for (const keyword of kws) {
      created.push(
        await tx.trackedKeyword.upsert({
          where: { projectId_keyword: { projectId: id, keyword } },
          create: { projectId: id, keyword, depth: 100, frequency: body.frequency ?? projFreq },
          update: { active: true },
        })
      );
    }
    return created;
    });
    if (created.length && body.check !== false) await enqueue(id, QUEUES.rankOne, { trackedIds: created.map((c) => c.id) });
    return created;
  },

  "rank/check": async ({ id, body }) => {
    // solo keywords de este proyecto (antes se podían revisar —y cobrar— las de otro)
    const ids: string[] = (await db.trackedKeyword.findMany({ where: { projectId: id, active: true, ...(body.ids?.length ? { id: { in: body.ids } } : {}) }, select: { id: true } })).map((t) => t.id);
    if (!ids.length) throw new HttpError(400, "No hay keywords trackeadas para revisar");
    await assertIdle(id, QUEUES.rankOne, "una revisión de rankings");
    await assertBudget({ serpent: est.serpCalls(ids.length) }, `Rank tracking (${ids.length} keywords)`);
    return enqueue(id, QUEUES.rankOne, { trackedIds: ids });
  },

  "gsc/sync": async ({ id, body }) => {
    await assertIdle(id, QUEUES.gscSync, "una sincronización de Search Console");
    if (!(await gscAvailable(id))) throw new HttpError(400, "Search Console no está conectado: conéctalo en Ajustes");
    return enqueue(id, QUEUES.gscSync, { backfillDays: Math.min(Math.max(Number(body.backfillDays ?? 90) || 90, 1), 480) });
  },

  alerts: async ({ id }) => enqueue(id, QUEUES.alerts, {}),

  /** Empieza la conexión OAuth con Google: devuelve la URL de consentimiento */
  "gsc/connect": async ({ id, url, user }) => {
    if (!oauthConfigured()) throw new HttpError(400, "La conexión con Google no está configurada en el servidor (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, TOKEN_ENC_KEY)");
    return { url: await startUrl(id, user.id, url.origin) };
  },

  "jobs/cancel": async ({ id, body }) => {
    await db.jobRun.findFirstOrThrow({ where: { id: body.jobId, projectId: id } });
    return cancelJob(body.jobId);
  },

  content: async ({ id, body }) => {
    await assertResource(id,"briefs",1);
    if (!body.url || !body.keyword) throw new HttpError(400, "Falta la URL o la keyword");
    const [u] = await ownUrls(id, [body.url]);
    if (!u) throw new HttpError(400, "URL inválida");
    await assertBudget({ serpent: est.serpCalls(1), llm: est.llmBrief() }, "Optimización de contenido");
    const a = await withProjectQuota(id,"briefs",1,tx=>tx.contentAnalysis.create({ data: { projectId: id, url: u, keyword: normTerm(body.keyword), pageKind: ["article","listing","landing","product"].includes(body.pageKind) ? body.pageKind : null } }));
    await enqueue(id, QUEUES.content, { contentId: a.id }, a.id);
    return a;
  },

  "content/rebrief": async ({ id, body }) => {
    const a = await ownContent(id, body.cid);
    if(a.status!=="done")throw new HttpError(409,"Espera a que termine el análisis");
    // se corre en la request: reserva propia para que dos "regenerar" seguidos no se pasen del límite
    const brief = await runInlineJob(
      id, "content.rebrief",
      async () => {
        await assertBudget({ llm: est.llmBrief() }, "Regenerar brief");
        return makeBrief(a.result as unknown as ContentResult, a.project.language, a.project.country);
      }
    );
    return storeBrief(a.id, brief, "regenerate");
  },
};

const PATCHS: Record<string, H> = {
  ...PRODUCT_PATCHS,
  "": async ({ id, body }) => {
    const data: Prisma.ProjectUpdateInput = {};
    for (const k of ["name", "domain", "country", "language", "gscProperty"] as const) if (k in body) (data as any)[k] = body[k] || (k === "gscProperty" ? null : body[k]);
    if (body.gscProperty) data.gscProperty = await resolveGscProperty(body.gscProperty, id);
    if ("locationCode" in body) data.locationCode = Number(body.locationCode);
    if (body.settings) {
      const p = await db.project.findUniqueOrThrow({ where: { id } });
      // merge de un nivel: { keywords: {...} } no borra claves de keywords que no vengan en el body
      const cur = (p.settings ?? {}) as Record<string, any>;
      const next: Record<string, any> = { ...cur };
      for (const [k, v] of Object.entries(body.settings as Record<string, any>)) next[k] = v && typeof v === "object" && !Array.isArray(v) && cur[k] && typeof cur[k] === "object" ? { ...cur[k], ...v } : v;
      data.settings = next;
      // cambiar la frecuencia del proyecto la aplica a todas sus keywords trackeadas
      const freq = (body.settings as any).rank?.frequency;
      if (freq === "daily" || freq === "weekly") await db.trackedKeyword.updateMany({ where: { projectId: id }, data: { frequency: freq } });
    }
    return db.project.update({ where: { id }, data });
  },

  keywords: async ({ id, body }) => {
    switch (body.action) {
      case "mapPage": {
        const c=await db.cluster.findFirstOrThrow({where:{id:body.clusterId,projectId:id}});
        const targetUrl=body.url?(await ownUrls(id,[body.url]))[0]:null;
        if(body.url&&!targetUrl)throw new HttpError(400,"URL inválida");
        return db.cluster.update({where:{id:c.id},data:{targetUrl}});
      }
      case "move": {
        const k = await db.keyword.findFirstOrThrow({ where: { id: body.keywordId, projectId: id } });
        await ownOptional("cluster", id, body.clusterId);
        await db.keyword.update({ where: { id: k.id }, data: { clusterId: body.clusterId ?? null, locked: true } });
        if (k.clusterId) await refreshCluster(k.clusterId);
        if (body.clusterId) await refreshCluster(body.clusterId);
        return { ok: true };
      }
      case "exclude":
        return db.keyword.updateMany({ where: { projectId: id, id: { in: body.ids } }, data: { excluded: Boolean(body.value) } });
      case "clusterTopic": {
        const c = await db.cluster.findFirstOrThrow({ where: { projectId: id, id: body.clusterId } });
        await ownOptional("topic", id, body.topicId);
        // Cambiar de topic suelta la pillar manual del topic anterior
        return db.cluster.update({ where: { id: c.id }, data: { topicId: body.topicId ?? null, topicLocked: true, ...(c.topicId !== (body.topicId ?? null) ? { isPillar: false, pillarLocked: false } : {}) } });
      }
      case "pillar": {
        const c = await db.cluster.findFirstOrThrow({ where: { id: body.clusterId, projectId: id } });
        if (c.topicId) await db.cluster.updateMany({ where: { projectId: id, topicId: c.topicId }, data: { isPillar: false, pillarLocked: false } });
        return db.cluster.update({ where: { id: c.id }, data: { isPillar: true, pillarLocked: true, topicLocked: Boolean(c.topicId) } });
      }
      case "renameCluster":
        return db.cluster.updateMany({ where: { projectId: id, id: body.clusterId }, data: { name: body.name, nameLocked: true } });
      case "renameTopic":
        return db.topic.updateMany({ where: { projectId: id, id: body.topicId }, data: { name: body.name, nameLocked: true } });
      case "unlock": {
        // Quita todas las marcas manuales de un keyword, cluster o topic
        if (body.keywordId) return db.keyword.updateMany({ where: { projectId: id, id: body.keywordId }, data: { locked: false } });
        if (body.clusterId) return db.cluster.updateMany({ where: { projectId: id, id: body.clusterId }, data: { topicLocked: false, nameLocked: false, pillarLocked: false } });
        if (body.topicId) return db.topic.updateMany({ where: { projectId: id, id: body.topicId }, data: { nameLocked: false } });
        throw new Error("unlock");
      }
      case "positions": {
        for (const n of body.nodes ?? []) {
          if (n.kind === "topic") await db.topic.updateMany({ where: { projectId: id, id: n.id }, data: { pos: n.pos } });
          if (n.kind === "cluster") await db.cluster.updateMany({ where: { projectId: id, id: n.id }, data: { pos: n.pos } });
        }
        return { ok: true };
      }
    }
    throw new Error("action");
  },

  alerts: async ({ id, body }) => db.alert.updateMany({ where: { projectId: id, ...(body.ids ? { id: { in: body.ids } } : {}) }, data: { seen: true } }),

  rank: async ({ id, body }) => db.trackedKeyword.updateMany({ where: { projectId: id, id: body.id }, data: { ...(body.frequency === "daily" || body.frequency === "weekly" ? { frequency: body.frequency } : {}) } }),

  content: async ({ id, body, user }) => {
    const a = await ownContent(id,body.cid);
    validateBrief(body.brief);
    return storeBrief(a.id,body.brief,"edit",user.id);
  },
};

const DELETES: Record<string, H> = {
  ...PRODUCT_DELETES,
  "gsc/connect": async ({ id }) => {
    await disconnect(id);
    return { ok: true };
  },
  "": async ({ id }) => db.project.delete({ where: { id } }),
  rank: async ({ id, body }) => db.trackedKeyword.deleteMany({ where: { projectId: id, id: { in: body.ids ?? [] } } }),
  "keywords/run": async ({ id, body }) => db.keywordRun.deleteMany({ where: { projectId: id, id: body.runId } }),
  "keywords/topic": async ({ id, body }) => {
    await db.cluster.updateMany({ where: { projectId: id, topicId: body.topicId }, data: { topicId: null, isPillar: false } });
    return db.topic.deleteMany({ where: { projectId: id, id: body.topicId } });
  },
  content: async ({ id, body }) => db.contentAnalysis.deleteMany({ where: { projectId: id, id: body.cid } }),
};

function make(table: Record<string, H>) {
  return async (req: Request, { params }: { params: { id: string; path: string[] } }) => {
    const path = params.path.filter((s) => s !== "_");
    const key = path.join("/");
    const h = table[key];
    if (!h) return bad("not found", 404);
    let user;
    try {
      user = await requireUser(req);
      if (!memLimit(`api:${user.id}`, 600, 60_000)) return bad("Demasiadas solicitudes: espera un minuto", 429);
      // borrar el proyecto: solo owner/admin del workspace; todo lo demás, cualquier miembro
      await requireProject(user.id, params.id, req.method === "DELETE" && key === "" ? "admin" : "member");
    } catch (e) {
      if (e instanceof AuthError) return bad(e.message, e.status);
      throw e;
    }
    let body: any = {};
    if (req.method !== "GET") {
      const ct = req.headers.get("content-type") ?? "";
      body = ct.includes("json") || !ct ? await req.json().catch(() => ({})) : Buffer.from(await req.arrayBuffer());
    }
    try {
      const r = await h({ id: params.id, path, url: new URL(req.url), body, user });
      return r instanceof Response ? r : ok(r);
    } catch (e) {
      if (e instanceof BriefValidationError || e instanceof BillingError || e instanceof ProductError || e instanceof PlanLimitError) return bad(e.message,e.status);
      if (e instanceof AuthError) return bad(e.message,e.status);
      if (e instanceof HttpError) return bad(e.message, e.status);
      if (e instanceof GscNotConnected) return bad(e.message, 400);
      console.error(`[api] ${req.method} ${key}`, e);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") return bad("no existe", 404);
      if (e instanceof Error && e.message.startsWith("Propiedad GSC inválida")) return bad(e.message, 400);
      if (e instanceof BudgetError) return bad(e.message, 402);
      return bad(e instanceof Error ? e.message : "error", 500);
    }
  };
}

export const GET = make(GETS);
export const POST = make(POSTS);
export const PATCH = make(PATCHS);
export const DELETE = make(DELETES);
