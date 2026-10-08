/** Estado del wizard de inicio y sugerencias de keywords (de Search Console o del propio sitio). */
import { db } from "./db";
import { gscAvailable } from "./providers/google";
import { brandFromDomain, isBrandQuery } from "./report-rules";

export const STEPS = ["site", "audit", "gsc", "keywords", "rank"] as const;
export type Step = (typeof STEPS)[number];

/** Frases candidatas del title/H1 de la home: "Tornillos y fijaciones | SinTornillo" → "tornillos y fijaciones". */
export function phrasesFrom(texts: (string | null | undefined)[], brand: string): string[] {
  const out: string[] = [];
  for (const t of texts) {
    for (const part of (t ?? "").split(/\s[|–—-]\s|[|·•:]/)) {
      const p = part.toLowerCase().replace(/\s+/g, " ").trim();
      if (p.length < 4 || p.split(" ").length > 6) continue;
      if (isBrandQuery(p, brand) || /^(inicio|home|bienvenid[oa]s?|tienda online)$/.test(p)) continue;
      if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

export async function onboarding(projectId: string) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const st = ((p.settings ?? {}) as Record<string, any>).onboarding ?? {};
  const brand = brandFromDomain(p.domain);
  const [crawl, run, tracked, gscMode] = await Promise.all([
    db.crawl.findFirst({ where: { projectId }, orderBy: { startedAt: "desc" }, select: { id: true, status: true, reason: true, stats: true } }),
    db.keywordRun.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, seeds: true } }),
    db.trackedKeyword.count({ where: { projectId, active: true } }),
    gscAvailable(projectId),
  ]);

  // sugerencias: consultas reales de Google (sin marca) y, si no hay, frases del title/H1 de la home
  const since = new Date(Date.now() - 90 * 864e5);
  const gq = await db.gscRow.groupBy({ by: ["query"], where: { projectId, date: { gte: since } }, _sum: { impressions: true }, _avg: { position: true }, orderBy: { _sum: { impressions: "desc" } }, take: 60 });
  const queries = gq.map((r) => ({ q: r.query, impr: r._sum.impressions ?? 0, pos: r._avg.position ?? 99 })).filter((r) => !isBrandQuery(r.q, brand));
  let seeds = queries.slice(0, 6).map((r) => r.q);
  if (seeds.length < 3 && crawl) {
    const home = await db.page.findFirst({ where: { crawlId: crawl.id, depth: 0 }, select: { title: true, h1: true } });
    seeds = [...new Set([...seeds, ...phrasesFrom([home?.title, ...(home?.h1 ?? [])], brand)])].slice(0, 6);
  }
  // para monitorear: lo que ya rankea cerca de la primera página (4–20) o lo principal del research
  let rank = queries.filter((r) => r.pos >= 3 && r.pos <= 20).slice(0, 10).map((r) => r.q);
  if (rank.length < 5 && run?.status === "done") {
    const cl = await db.cluster.findMany({ where: { runId: run.id }, orderBy: { volume: "desc" }, take: 10, select: { primary: true } });
    rank = [...new Set([...rank, ...cl.map((c) => c.primary)])].slice(0, 10);
  }
  if (rank.length < 3) rank = [...new Set([...rank, ...seeds])].slice(0, 10);

  const s = (crawl?.stats ?? {}) as Record<string, any>;
  const status: Record<Step, "done" | "running" | "todo" | "skipped" | "failed"> = {
    site: "done",
    audit: !crawl ? "todo" : ["queued", "running"].includes(crawl.status) ? "running" : crawl.status === "failed" || crawl.status === "cancelled" ? "failed" : "done",
    gsc: gscMode && p.gscProperty ? "done" : st.skipGsc || st.skipped?.includes("gsc") ? "skipped" : "todo",
    keywords: !run ? (st.skipped?.includes("keywords") ? "skipped" : "todo") : run.status === "done" ? "done" : run.status === "error" ? "failed" : "running",
    rank: tracked ? "done" : st.skipped?.includes("rank") ? "skipped" : "todo",
  };
  return {
    domain: p.domain,
    status,
    finished: Boolean(st.done) || STEPS.every((k) => status[k] === "done" || status[k] === "skipped"),
    dismissed: Boolean(st.done),
    crawl: crawl ? { status: crawl.status, reason: crawl.reason, health: s.health ?? null, healthNote: s.healthNote ?? null, pages: s.pages ?? 0, critical: s.critical ?? 0 } : null,
    gsc: { connected: Boolean(gscMode), property: p.gscProperty },
    tracked,
    suggestions: { seeds, rank, fromGsc: queries.length > 0 },
  };
}
