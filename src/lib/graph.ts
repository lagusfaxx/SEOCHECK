import { db } from "./db";
import { ISSUE_LABELS } from "./audit/issues";
import { hostOf, normUrl } from "./util";
import { nodeId, type GEdge, type GNode, type GResult, type GType } from "./graph-types";

const f0 = (n: number | null | undefined) => (n == null ? "–" : Math.round(n).toLocaleString("es-CL"));
const pathOf = (u: string) => {
  const p = u.replace(/^https?:\/\/[^/]+/, "") || "/";
  try {
    return decodeURI(p);
  } catch {
    return p;
  }
};

type Ctx = { projectId: string; site: string };

function mk(type: GType, key: string, label: string, extra: Partial<GNode> = {}): GNode {
  return { id: nodeId(type, key), type, key, label, ...extra };
}

function isOwn(ctx: Ctx, u: string) {
  const h = hostOf(u);
  return h === ctx.site || h.endsWith(`.${ctx.site}`);
}

function pageNode(ctx: Ctx, url: string, sub?: string) {
  const u = normUrl(url) ?? url;
  const own = isOwn(ctx, u);
  return mk("page", u, own ? pathOf(u) : `${hostOf(u)}${pathOf(u) === "/" ? "" : pathOf(u)}`, { own, url: u, sub });
}

async function latestCrawl(projectId: string) {
  return db.crawl.findFirst({ where: { projectId, status: { in: ["completed", "partial"] } }, orderBy: { startedAt: "desc" }, select: { id: true } });
}

async function latestRun(projectId: string) {
  return db.keywordRun.findFirst({ where: { projectId, status: "done" }, orderBy: { createdAt: "desc" }, select: { id: true } });
}

type Organic = { position: number; url: string; domain?: string; title?: string };

/** Último snapshot de SERP por keyword. */
async function snapshots(projectId: string) {
  const rows = await db.serpSnapshot.findMany({
    where: { projectId },
    orderBy: { fetchedAt: "desc" },
    distinct: ["keyword"],
    select: { keyword: true, organic: true, paa: true },
    take: 3000,
  });
  return rows.map((r) => ({ keyword: r.keyword, organic: (r.organic as unknown as Organic[]) ?? [], paa: r.paa }));
}

const since28 = () => new Date(Date.now() - 31 * 864e5);

/** Corre una transformación sobre un nodo y devuelve los nodos/aristas nuevos. Solo lee la base: no gasta APIs. */
export async function expand(projectId: string, type: GType, key: string, t: string): Promise<GResult> {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const ctx: Ctx = { projectId, site: hostOf(`https://${p.domain}`) };
  const from = nodeId(type, key);
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const link = (n: GNode, label?: string, reverse = false) => {
    nodes.push(n);
    edges.push(reverse ? { source: n.id, target: from, label } : { source: from, target: n.id, label });
  };
  const empty = (note: string): GResult => ({ nodes: [], edges: [], note });

  switch (`${type}.${t}`) {
    case "site.topics": {
      const run = await latestRun(projectId);
      if (!run) return empty("Sin research de keywords");
      const topics = await db.topic.findMany({ where: { runId: run.id }, include: { clusters: { select: { volume: true } } } });
      for (const tp of topics.sort((a, b) => b.clusters.reduce((s, c) => s + c.volume, 0) - a.clusters.reduce((s, c) => s + c.volume, 0)))
        link(mk("topic", tp.id, tp.name, { sub: `${tp.clusters.length} clusters · ${f0(tp.clusters.reduce((s, c) => s + c.volume, 0))} vol.` }));
      break;
    }
    case "site.competitors": {
      const snaps = await snapshots(projectId);
      if (!snaps.length) return empty("Sin SERPs guardadas (corre keywords o rankings)");
      const count = new Map<string, number>();
      for (const s of snaps)
        for (const o of s.organic.slice(0, 10)) {
          const d = hostOf(o.url);
          if (d && d !== ctx.site && !d.endsWith(`.${ctx.site}`)) count.set(d, (count.get(d) ?? 0) + 1);
        }
      for (const [d, n] of [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) link(mk("domain", d, d, { sub: `en ${n} keywords` }), `${n}`);
      break;
    }
    case "site.pages": {
      const crawl = await latestCrawl(projectId);
      if (!crawl) return empty("Sin crawl");
      const pages = await db.page.findMany({ where: { crawlId: crawl.id, status: 200 }, orderBy: { inlinks: "desc" }, take: 25, select: { url: true, inlinks: true } });
      for (const pg of pages) link(pageNode(ctx, pg.url, `${f0(pg.inlinks)} links entrantes`));
      break;
    }
    case "site.issues": {
      const crawl = await latestCrawl(projectId);
      if (!crawl) return empty("Sin crawl");
      const g = await db.issue.groupBy({ by: ["code", "severity"], where: { crawlId: crawl.id }, _count: true });
      const order = { critical: 0, warning: 1, info: 2 } as Record<string, number>;
      for (const i of g.sort((a, b) => order[a.severity] - order[b.severity] || b._count - a._count))
        link(mk("issue", i.code, ISSUE_LABELS[i.code] ?? i.code, { sub: `${i.severity === "critical" ? "crítico" : i.severity} · ${f0(i._count)} URL${i._count === 1 ? "" : "s"}` }));
      break;
    }
    case "site.gsc_queries":
    case "page.gsc_queries": {
      const where = { projectId, date: { gte: since28() }, ...(type === "page" ? { page: key } : {}) };
      const q = await db.gscRow.groupBy({ by: ["query"], where, _sum: { clicks: true, impressions: true }, _avg: { position: true } });
      if (!q.length) return empty("Sin datos de Search Console");
      for (const r of q.sort((a, b) => (b._sum.impressions ?? 0) - (a._sum.impressions ?? 0)).slice(0, 20))
        link(mk("keyword", r.query, r.query, { sub: `${f0(r._sum.clicks)} clics · ${f0(r._sum.impressions)} impr · pos ${r._avg.position?.toFixed(1)}` }), `pos ${r._avg.position?.toFixed(0)}`);
      break;
    }
    case "topic.clusters": {
      const cs = await db.cluster.findMany({ where: { projectId, topicId: key }, orderBy: { volume: "desc" }, include: { _count: { select: { keywords: true } } } });
      for (const c of cs) link(mk("cluster", c.id, c.name, { sub: `${f0(c.volume)} vol. · ${c._count.keywords} kw` }));
      break;
    }
    case "cluster.keywords": {
      const ks = await db.keyword.findMany({ where: { projectId, clusterId: key, excluded: false }, orderBy: [{ volume: { sort: "desc", nulls: "last" } }], take: 30 });
      for (const k of ks) link(mk("keyword", k.term, k.term, { sub: k.volume != null ? `${f0(k.volume)} vol.` : undefined }));
      break;
    }
    case "cluster.serp": {
      const c = await db.cluster.findFirstOrThrow({ where: { id: key, projectId } });
      for (const u of c.urls.slice(0, 15)) link(pageNode(ctx, u));
      break;
    }
    case "cluster.topic": {
      const c = await db.cluster.findFirstOrThrow({ where: { id: key, projectId }, include: { topic: true } });
      if (!c.topic) return empty("Sin topic");
      link(mk("topic", c.topic.id, c.topic.name), undefined, true);
      break;
    }
    case "keyword.serp":
    case "keyword.paa": {
      const s = await db.serpSnapshot.findFirst({ where: { projectId, keyword: key }, orderBy: { fetchedAt: "desc" } });
      if (!s) return empty("Sin SERP guardada para esta keyword");
      if (t === "paa") {
        if (!s.paa.length) return empty("Google no mostró preguntas");
        for (const q of s.paa) link(mk("question", q, q));
      } else {
        for (const o of (s.organic as unknown as Organic[]).slice(0, 10)) link(pageNode(ctx, o.url, o.title ? `#${o.position} · ${o.title}` : `#${o.position}`), `#${o.position}`);
      }
      break;
    }
    case "keyword.gsc_pages": {
      const r = await db.gscRow.groupBy({ by: ["page"], where: { projectId, query: key, date: { gte: since28() } }, _sum: { clicks: true, impressions: true }, _avg: { position: true } });
      if (!r.length) return empty("Sin datos de Search Console para esta consulta");
      for (const x of r.sort((a, b) => (b._sum.impressions ?? 0) - (a._sum.impressions ?? 0)).slice(0, 10))
        link(pageNode(ctx, x.page, `${f0(x._sum.impressions)} impr · pos ${x._avg.position?.toFixed(1)}`), `pos ${x._avg.position?.toFixed(0)}`);
      break;
    }
    case "keyword.cluster": {
      const k = await db.keyword.findFirst({ where: { projectId, term: key }, include: { cluster: true } });
      if (!k?.cluster) return empty("No está en un cluster");
      link(mk("cluster", k.cluster.id, k.cluster.name, { sub: `${f0(k.cluster.volume)} vol.` }), undefined, true);
      break;
    }
    case "page.inlinks":
    case "page.outlinks":
    case "page.issues": {
      const crawl = await latestCrawl(projectId);
      if (!crawl) return empty("Sin crawl");
      if (t === "issues") {
        const is = await db.issue.findMany({ where: { crawlId: crawl.id, url: key } });
        if (!is.length) return empty("Sin problemas");
        for (const i of is) link(mk("issue", i.code, ISSUE_LABELS[i.code] ?? i.code, { sub: i.detail ?? undefined }));
      } else if (t === "inlinks") {
        const ps = await db.page.findMany({ where: { crawlId: crawl.id, links: { has: key } }, take: 40, select: { url: true } });
        if (!ps.length) return empty("Ninguna página revisada la enlaza");
        for (const x of ps) link(pageNode(ctx, x.url), undefined, true);
      } else {
        const pg = await db.page.findFirst({ where: { crawlId: crawl.id, url: key }, select: { links: true } });
        if (!pg) return empty("No está en el último crawl");
        for (const u of pg.links.slice(0, 40)) link(pageNode(ctx, u));
      }
      break;
    }
    case "page.serp_keywords":
    case "domain.keywords":
    case "domain.pages": {
      const snaps = await snapshots(projectId);
      const match = (o: Organic) => (type === "page" ? (normUrl(o.url) ?? o.url) === key : hostOf(o.url) === key);
      const hits = snaps.flatMap((s) => s.organic.slice(0, 10).filter(match).map((o) => ({ keyword: s.keyword, o })));
      if (!hits.length) return empty("No aparece en las SERPs guardadas");
      if (t === "pages") {
        const best = new Map<string, number>();
        for (const h of hits) best.set(h.o.url, Math.min(best.get(h.o.url) ?? 99, h.o.position));
        for (const [u, pos] of [...best.entries()].sort((a, b) => a[1] - b[1]).slice(0, 20)) link(pageNode(ctx, u, `mejor posición #${pos}`));
      } else {
        for (const h of hits.sort((a, b) => a.o.position - b.o.position).slice(0, 25)) link(mk("keyword", h.keyword, h.keyword), `#${h.o.position}`, true);
      }
      break;
    }
    case "page.domain":
      link(mk("domain", hostOf(key), hostOf(key)), undefined, true);
      break;
    case "issue.pages": {
      const crawl = await latestCrawl(projectId);
      if (!crawl) return empty("Sin crawl");
      const is = await db.issue.findMany({ where: { crawlId: crawl.id, code: key }, take: 40 });
      for (const i of is) link(pageNode(ctx, i.url, i.detail ?? undefined), undefined, true);
      break;
    }
    default:
      return empty("Transformación no disponible");
  }
  // sin duplicados (la misma URL puede venir dos veces)
  const seen = new Set<string>();
  return { nodes: nodes.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true))), edges };
}

/** Buscador del explorador: keywords, clusters, páginas y dominios. */
export async function graphSearch(projectId: string, q: string): Promise<GNode[]> {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const ctx: Ctx = { projectId, site: hostOf(`https://${p.domain}`) };
  const term = q.trim().toLowerCase();
  if (term.length < 2) return [];
  const crawl = await latestCrawl(projectId);
  const [kws, cls, pages] = await Promise.all([
    db.keyword.findMany({ where: { projectId, term: { contains: term } }, take: 8, orderBy: [{ volume: { sort: "desc", nulls: "last" } }] }),
    db.cluster.findMany({ where: { projectId, name: { contains: term, mode: "insensitive" } }, take: 5, orderBy: { volume: "desc" } }),
    crawl ? db.page.findMany({ where: { crawlId: crawl.id, url: { contains: term, mode: "insensitive" } }, take: 8, select: { url: true } }) : [],
  ]);
  const out: GNode[] = [
    ...kws.map((k) => mk("keyword", k.term, k.term, { sub: k.volume != null ? `${f0(k.volume)} vol.` : undefined })),
    ...cls.map((c) => mk("cluster", c.id, c.name, { sub: `${f0(c.volume)} vol.` })),
    ...pages.map((x) => pageNode(ctx, x.url)),
  ];
  // un dominio escrito tal cual
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(term)) out.push(mk("domain", hostOf(`https://${term}`), hostOf(`https://${term}`)));
  // una keyword que no está en el research igual se puede explorar (SERP/GSC)
  if (!kws.some((k) => k.term === term) && !term.includes(".")) out.push(mk("keyword", term, term, { sub: "buscar" }));
  return out;
}

export function siteNode(domain: string): GNode {
  const d = hostOf(`https://${domain}`);
  return mk("site", d, d);
}
