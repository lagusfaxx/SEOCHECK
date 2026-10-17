import { db } from "./db";
import { hostOf, urlKey } from "./util";
import { siteVocabulary, triageKeyword } from "./keyword-triage";
import { brandFromDomain } from "./report-rules";
export async function clusterInsights(projectId: string, runId?: string) {
  const [project, clusters, snapshots, gsc] = await Promise.all([
    db.project.findUniqueOrThrow({ where: { id: projectId } }),
    db.cluster.findMany({
      where: { projectId, ...(runId ? { runId } : {}) },
      include: {
        keywords: { where: { excluded: false }, select: { term: true } },
      },
    }),
    db.serpSnapshot.findMany({
      where: { projectId },
      orderBy: { fetchedAt: "desc" },
      select: { keyword: true, organic: true, fetchedAt: true },
    }),
    db.gscRow.groupBy({
      by: ["query", "page"],
      where: { projectId, date: { gte: new Date(Date.now() - 30 * 864e5) } },
      _sum: { impressions: true, clicks: true },
    }),
  ]);
  const serps = new Map<string, Set<string>>();
  for (const s of snapshots)
    if (!serps.has(s.keyword))
      serps.set(
        s.keyword,
        new Set((s.organic as any[]).slice(0, 10).map((o) => urlKey(o.url))),
      );
  // triaje para los clusters sin página: rubro del sitio, marca propia y páginas que ya tratan el tema
  const crawl = await db.crawl.findFirst({ where: { projectId, private: false, status: { in: ["completed", "partial"] } }, orderBy: { startedAt: "desc" }, select: { id: true } });
  const sitePages = crawl ? await db.page.findMany({ where: { crawlId: crawl.id, status: 200, noindex: false }, select: { url: true, title: true, h1: true } }) : [];
  const site = hostOf(`https://${project.domain.replace(/^https?:\/\//, "")}`);
  const triageCtx = {
    vocab: siteVocabulary([...sitePages.map((p) => `${p.title ?? ""} ${p.h1.join(" ")}`), ...gsc.map((r) => r.query)]),
    brand: brandFromDomain(site),
    home: `https://${site}/`,
    pages: sitePages.map((p) => ({ url: p.url, text: `${p.title ?? ""} ${p.h1.join(" ")}` })),
    gsc: gsc.map((r) => ({ query: r.query, page: r.page, impressions: r._sum.impressions ?? 0 })),
  };
  const own = (url: string) => {
    const h = hostOf(url),
      d = hostOf(project.domain);
    return h === d || h.endsWith(`.${d}`);
  };
  return clusters.map((c) => {
    const terms = new Set(c.keywords.map((k) => k.term));
    const primary = serps.get(c.primary);
    const overlaps = c.keywords
      .filter((k) => k.term !== c.primary && serps.has(k.term))
      .map((k) => {
        const peer = serps.get(k.term)!;
        return {
          keyword: k.term,
          shared: primary
            ? [...peer].filter((u) => primary.has(u)).length
            : null,
          denominator: primary ? Math.min(10, primary.size, peer.size) : null,
        };
      });
    const owned = [
      ...new Set([
        ...(c.targetUrl ? [c.targetUrl] : []),
        ...c.urls.filter(own),
        ...gsc.filter((r) => terms.has(r.query)).map((r) => r.page),
      ]),
    ];
    const significant = gsc.filter(
      (r) => terms.has(r.query) && (r._sum.impressions ?? 0) >= 20,
    );
    const queries = new Map<string, Set<string>>();
    for (const r of significant) {
      const pages = queries.get(r.query) ?? new Set();
      pages.add(r.page);
      queries.set(r.query, pages);
    }
    const cannibal = [...queries.values()].some((p) => p.size > 1);
    const triage = !cannibal && !owned.length ? triageKeyword(c.primary, triageCtx) : null;
    if (triage?.page) owned.push(triage.page);
    const outside = triage && (triage.verdict === "unknown_terms" || triage.verdict === "off_topic");
    return {
      id: c.id,
      name: c.name,
      primary: c.primary,
      pages: owned,
      status: cannibal
        ? "potential-cannibal"
        : owned.length
          ? "mapped"
          : "unmapped",
      recommendation: cannibal
        ? "consolidate"
        : owned.length
          ? "optimize"
          : outside
            ? "review"
            : "create",
      overlaps,
      evidence: primary ? "serp" : "no-serp",
      note: cannibal
        ? "Varias URLs reciben impresiones por la misma consulta. Confirma intención y marca antes de consolidar."
        : triage && triage.verdict !== "create"
          ? `${triage.reason}.`
        : !primary
          ? "Sin SERPs guardadas: no se afirma solapamiento real."
          : "Coincidencias de URLs entre los últimos top 10 guardados; no equivalen a una probabilidad de éxito.",
    };
  });
}
export async function rankOpportunities(projectId: string) {
  return db.$queryRaw<
    { keyword: string; impressions: number; clicks: number; position: number }[]
  >`
    SELECT query AS keyword, SUM(impressions)::int AS impressions, SUM(clicks)::int AS clicks,
      SUM(position * impressions) / NULLIF(SUM(impressions),0) AS position
    FROM "GscRow" WHERE "projectId"=${projectId} AND date >= ${new Date(Date.now() - 30 * 864e5)}
      AND query NOT IN (SELECT keyword FROM "TrackedKeyword" WHERE "projectId"=${projectId} AND active=true)
    GROUP BY query HAVING SUM(impressions)>=20 AND SUM(position * impressions) / NULLIF(SUM(impressions),0) BETWEEN 4 AND 20
    ORDER BY SUM(impressions) DESC LIMIT 20`;
}
