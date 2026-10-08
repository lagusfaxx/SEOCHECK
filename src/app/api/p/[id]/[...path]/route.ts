import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { cancelJob, enqueue, QUEUES } from "@/lib/queue";
import { sweepStale, workerAlive } from "@/lib/jobs";
import { refreshCluster } from "@/lib/keywords/pipeline";
import { ISSUE_LABELS } from "@/lib/audit/issues";
import { indexNow, resolveGscProperty } from "@/lib/providers/google";
import { gscTargetFor, makeBrief, type ContentResult } from "@/lib/content/analyze";
import { parseKeywordPlannerCsv } from "@/lib/volume/csv";
import { backfillVolumes, volumeChainStatus, writeCache } from "@/lib/volume/broker";
import { env } from "@/lib/env";
import { llmStatus } from "@/lib/providers/llm";
import { assertBudget, BudgetError, budgetLimits, est, monthStart, spentThisMonth } from "@/lib/budget";
import { normTerm, normUrl } from "@/lib/util";
import { buildReport } from "@/lib/report";
import { expand, graphSearch, siteNode } from "@/lib/graph";
import { TRANSFORMS, type GType } from "@/lib/graph-types";

export const dynamic = "force-dynamic";

type Ctx = { id: string; path: string[]; url: URL; body: any };
type H = (c: Ctx) => Promise<unknown>;

const ok = (data: unknown) => Response.json(data ?? { ok: true });
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
  "": async ({ id }) => {
    const p = await db.project.findUniqueOrThrow({ where: { id } });
    const chain = await volumeChainStatus();
    return {
      ...p,
      volumeChain: chain,
      providers: {
        serp: Boolean(env.serpentKey), volume: chain.find((c) => c.available)?.provider ?? false, embeddings: env.embeddingsUrl ? "local" : env.openaiKey ? "openai" : "hash",
        llm: llmStatus().available ? `${env.llmProvider}:${env.llmModel}` : false, gsc: Boolean(env.gscCredentials), psi: Boolean(env.psiKey), render: Boolean(env.browserWs), indexnow: Boolean(env.indexNowKey),
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
    const crawlId = url.searchParams.get("crawl") ?? crawls[0]?.id;
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

  "audit/issue": async ({ url }) => {
    const crawlId = url.searchParams.get("crawl")!;
    const code = url.searchParams.get("code")!;
    return db.issue.findMany({ where: { crawlId, code }, take: 2000 });
  },

  "audit/page": async ({ url }) => {
    const crawlId = url.searchParams.get("crawl")!;
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
    if (!TRANSFORMS[type]?.some((x) => x.id === t)) throw new Error("transformación inválida");
    return expand(id, type, url.searchParams.get("key") ?? "", t);
  },
  "report/last": async ({ id }) => db.jobRun.findFirst({ where: { projectId: id, kind: QUEUES.full }, orderBy: { createdAt: "desc" } }),
  /** Para el formulario de Contenido: qué URL ya rankea para la keyword en Search Console. */
  "content/target": async ({ id, url }) => gscTargetFor(id, url.searchParams.get("keyword") ?? "", url.searchParams.get("url") || undefined),
  "content/one": async ({ url }) => db.contentAnalysis.findUnique({ where: { id: url.searchParams.get("cid")! } }),
};

const POSTS: Record<string, H> = {
  "keywords/run": async ({ id, body }) => {
    const seeds: string[] = (body.seeds ?? []).map((s: string) => normTerm(s)).filter(Boolean);
    if (!seeds.length) throw new Error("seeds");
    const kwOpts = { serpTop: 150, serpExpansion: 20, maxKeywords: 400, ...((((await db.project.findUniqueOrThrow({ where: { id } })).settings ?? {}) as any).keywords ?? {}) };
    await assertBudget({ serpent: est.serpCalls(seeds.length + kwOpts.serpExpansion + kwOpts.serpTop), llm: est.llmIntent(kwOpts.maxKeywords) }, "Research de keywords");
    // volumeLive: DataForSEO endpoint Live (solo si se pide explícitamente); por defecto standard queue
    const run = await db.keywordRun.create({ data: { projectId: id, seeds, threshold: Number(body.threshold ?? 0.45), options: { volumeLive: body.volumeLive === true } } });
    await enqueue(id, QUEUES.keywords, { runId: run.id }, run.id);
    return run;
  },

  "keywords/rerun": async ({ id, body }) => {
    const run = await db.keywordRun.findFirstOrThrow({ where: { projectId: id, id: body.runId } });
    await db.keywordRun.update({ where: { id: run.id }, data: { status: "queued" } });
    return enqueue(id, QUEUES.keywords, { runId: run.id }, run.id);
  },

  "keywords/topic": async ({ id, body }) => db.topic.create({ data: { projectId: id, runId: body.runId ?? null, name: body.name ?? "nuevo topic", pos: body.pos, nameLocked: true } }),

  "keywords/cluster": async ({ id, body }) =>
    db.cluster.create({ data: { projectId: id, runId: body.runId ?? null, name: body.name ?? "nuevo cluster", primary: body.name ?? "", topicId: body.topicId ?? null } }),

  audit: async ({ id, body }) => {
    const crawl = await db.crawl.create({
      data: { projectId: id, options: { maxPages: Number(body.maxPages ?? 500), concurrency: Number(body.concurrency ?? 5), render: Boolean(body.render), startUrl: body.startUrl || undefined } },
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
    const opts = {
      maxPages: Math.min(Number(body.maxPages ?? 1000), 20000),
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

  "audit/psi": async ({ id, body }) => enqueue(id, QUEUES.psi, { urls: (body.urls ?? []).slice(0, 20), strategies: body.strategies ?? ["mobile", "desktop"] }),

  "audit/inspect": async ({ id, body }) => enqueue(id, QUEUES.inspect, { urls: (body.urls ?? []).slice(0, 100) }),

  indexnow: async ({ id, body }) => {
    const p = await db.project.findUniqueOrThrow({ where: { id } });
    const status = await indexNow(p.domain, (body.urls ?? []).map((u: string) => normUrl(u)).filter(Boolean));
    return { status };
  },

  rank: async ({ id, body }) => {
    const kws: string[] = [...new Set<string>((body.keywords ?? []).map((k: string) => normTerm(k)).filter(Boolean))];
    // frecuencia: la del body, si no la del proyecto (settings.rank.frequency), si no semanal
    const projFreq = ((((await db.project.findUniqueOrThrow({ where: { id } })).settings ?? {}) as any).rank?.frequency as string) ?? "weekly";
    const created = [];
    for (const keyword of kws) {
      created.push(
        await db.trackedKeyword.upsert({
          where: { projectId_keyword: { projectId: id, keyword } },
          create: { projectId: id, keyword, depth: 100, frequency: body.frequency ?? projFreq },
          update: { active: true },
        })
      );
    }
    if (created.length && body.check !== false) await enqueue(id, QUEUES.rankOne, { trackedIds: created.map((c) => c.id) });
    return created;
  },

  "rank/check": async ({ id, body }) => {
    const ids: string[] = body.ids?.length ? body.ids : (await db.trackedKeyword.findMany({ where: { projectId: id, active: true }, select: { id: true } })).map((t) => t.id);
    await assertBudget({ serpent: est.serpCalls(ids.length) }, `Rank tracking (${ids.length} keywords)`);
    return enqueue(id, QUEUES.rankOne, { trackedIds: ids });
  },

  "gsc/sync": async ({ id, body }) => enqueue(id, QUEUES.gscSync, { backfillDays: Number(body.backfillDays ?? 90) }),

  alerts: async ({ id }) => enqueue(id, QUEUES.alerts, {}),

  "jobs/cancel": async ({ id, body }) => {
    await db.jobRun.findFirstOrThrow({ where: { id: body.jobId, projectId: id } });
    return cancelJob(body.jobId);
  },

  content: async ({ id, body }) => {
    const u = normUrl(body.url ?? "");
    if (!u || !body.keyword) throw new Error("url y keyword");
    await assertBudget({ serpent: est.serpCalls(1), llm: est.llmBrief() }, "Optimización de contenido");
    const a = await db.contentAnalysis.create({ data: { projectId: id, url: u, keyword: normTerm(body.keyword) } });
    await enqueue(id, QUEUES.content, { contentId: a.id }, a.id);
    return a;
  },

  "content/rebrief": async ({ id, body }) => {
    const a = await db.contentAnalysis.findUniqueOrThrow({ where: { id: body.cid }, include: { project: true } });
    await assertBudget({ llm: est.llmBrief() }, "Regenerar brief");
    const brief = await makeBrief(a.result as unknown as ContentResult, a.project.language, a.project.country);
    return db.contentAnalysis.update({ where: { id: a.id }, data: { brief: brief as any } });
  },
};

const PATCHS: Record<string, H> = {
  "": async ({ id, body }) => {
    const data: Prisma.ProjectUpdateInput = {};
    for (const k of ["name", "domain", "country", "language", "gscProperty"] as const) if (k in body) (data as any)[k] = body[k] || (k === "gscProperty" ? null : body[k]);
    if (body.gscProperty) data.gscProperty = await resolveGscProperty(body.gscProperty);
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
      case "move": {
        const k = await db.keyword.findFirstOrThrow({ where: { id: body.keywordId, projectId: id } });
        await db.keyword.update({ where: { id: k.id }, data: { clusterId: body.clusterId ?? null, locked: true } });
        if (k.clusterId) await refreshCluster(k.clusterId);
        if (body.clusterId) await refreshCluster(body.clusterId);
        return { ok: true };
      }
      case "exclude":
        return db.keyword.updateMany({ where: { projectId: id, id: { in: body.ids } }, data: { excluded: Boolean(body.value) } });
      case "clusterTopic": {
        const c = await db.cluster.findFirstOrThrow({ where: { projectId: id, id: body.clusterId } });
        // Cambiar de topic suelta la pillar manual del topic anterior
        return db.cluster.update({ where: { id: c.id }, data: { topicId: body.topicId ?? null, topicLocked: true, ...(c.topicId !== (body.topicId ?? null) ? { isPillar: false, pillarLocked: false } : {}) } });
      }
      case "pillar": {
        const c = await db.cluster.findFirstOrThrow({ where: { id: body.clusterId, projectId: id } });
        if (c.topicId) await db.cluster.updateMany({ where: { topicId: c.topicId }, data: { isPillar: false, pillarLocked: false } });
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

  content: async ({ id, body }) => db.contentAnalysis.updateMany({ where: { projectId: id, id: body.cid }, data: { brief: body.brief } }),
};

const DELETES: Record<string, H> = {
  "": async ({ id }) => db.project.delete({ where: { id } }),
  rank: async ({ id, body }) => db.trackedKeyword.deleteMany({ where: { projectId: id, id: { in: body.ids ?? [] } } }),
  "keywords/run": async ({ id, body }) => db.keywordRun.deleteMany({ where: { projectId: id, id: body.runId } }),
  "keywords/topic": async ({ id, body }) => {
    await db.cluster.updateMany({ where: { topicId: body.topicId }, data: { topicId: null, isPillar: false } });
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
    let body: any = {};
    if (req.method !== "GET") {
      const ct = req.headers.get("content-type") ?? "";
      body = ct.includes("json") || !ct ? await req.json().catch(() => ({})) : Buffer.from(await req.arrayBuffer());
    }
    try {
      const r = await h({ id: params.id, path, url: new URL(req.url), body });
      return r instanceof Response ? r : ok(r);
    } catch (e) {
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
