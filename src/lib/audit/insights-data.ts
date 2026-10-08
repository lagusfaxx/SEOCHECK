/** Junta las señales (GSC, rankings, PageSpeed) de un proyecto y arma los hallazgos de un crawl. */
import { db } from "../db";
import { urlKey } from "../util";
import { psiVerdict, type PsiField } from "../report-rules";
import { buildFindings, summarize, urlSection, type Signals } from "./insights";
import type { Cms } from "./cms";

export async function insightSignals(projectId: string): Promise<Omit<Signals, "cms" | "hitLimit">> {
  // Search Console: últimos 28 días con datos
  const last = await db.gscRow.findFirst({ where: { projectId }, orderBy: { date: "desc" }, select: { date: true } });
  const impr = new Map<string, number>();
  const pos = new Map<string, number>();
  if (last) {
    const since = new Date(last.date.getTime() - 27 * 864e5);
    const rows = await db.$queryRaw<{ page: string; impr: number; pos: number | null }[]>`
      SELECT page, SUM(impressions)::int AS impr, SUM(position * impressions) / NULLIF(SUM(impressions), 0) AS pos
      FROM "GscRow" WHERE "projectId" = ${projectId} AND date >= ${since} GROUP BY page`;
    for (const r of rows) {
      const k = urlKey(r.page);
      impr.set(k, (impr.get(k) ?? 0) + r.impr);
      if (r.pos != null) pos.set(k, Number(r.pos));
    }
  }
  // Rankings trackeados: última posición de cada keyword, por la URL que rankea
  const rank = new Map<string, { keyword: string; position: number }>();
  const tracked = await db.trackedKeyword.findMany({ where: { projectId, active: true }, select: { keyword: true, checks: { orderBy: { date: "desc" }, take: 1, select: { position: true, url: true } } } });
  for (const t of tracked) {
    const c = t.checks[0];
    if (!c?.url || c.position == null) continue;
    const k = urlKey(c.url);
    if (!rank.has(k) || rank.get(k)!.position > c.position) rank.set(k, { keyword: t.keyword, position: c.position });
  }
  // PageSpeed: plantillas con mala experiencia (campo malo, o laboratorio móvil < 50 sin campo)
  const psiBad = new Map<string, string>();
  const psi = await db.psiResult.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 200 });
  const seen = new Set<string>();
  for (const r of psi) {
    if (seen.has(`${r.url}|${r.strategy}`)) continue;
    seen.add(`${r.url}|${r.strategy}`);
    const v = psiVerdict(r.score, r.lab as { lcp?: number | null }, r.field as PsiField);
    if (!v.actionable) continue;
    const sec = urlSection(r.url);
    if (!psiBad.has(sec)) psiBad.set(sec, `${r.strategy === "mobile" ? "móvil" : "escritorio"} ${v.fieldBad ? "lento para usuarios reales" : `${r.score}/100 en laboratorio`}`);
  }
  return { impr, pos, rank, psiBad };
}

export async function auditInsights(projectId: string, crawlId: string) {
  const crawl = await db.crawl.findFirstOrThrow({ where: { id: crawlId, projectId } });
  const st = (crawl.stats ?? {}) as Record<string, any>;
  const opts = (crawl.options ?? {}) as Record<string, any>;
  const hitLimit = st.limitReached ?? Boolean(opts.maxPages && (st.pages ?? 0) - Math.min(st.orphans ?? 0, 300) >= opts.maxPages);
  const [pages, issues, sig] = await Promise.all([
    db.page.findMany({ where: { crawlId }, select: { url: true, status: true, depth: true, inlinks: true, jsonldTypes: true, error: true, canonical: true } }),
    db.issue.findMany({ where: { crawlId }, select: { url: true, code: true, severity: true, detail: true } }),
    insightSignals(projectId),
  ]);
  const r = buildFindings(pages, issues, { ...sig, cms: (st.cms as Cms) ?? null, hitLimit });
  return { ...r, summary: summarize(r.findings), hasGsc: sig.impr!.size > 0, cms: st.cms ?? null };
}
