import { db } from "../db";
import { strip } from "../text";

/**
 * Páginas del propio sitio que calzan con una keyword, sin gastar créditos:
 * se busca en las páginas de la última auditoría (URL, title, H1) y en las consultas de Search Console.
 */

/** Tokens comparables: sin tildes, sin palabras vacías cortas y con un singular aproximado ("balancines" → "balancin"). */
export function kwTokens(text: string): string[] {
  return [
    ...new Set(
      strip(text)
        .replace(/[^a-z0-9ñ]+/g, " ")
        .split(" ")
        .filter((t) => t.length > 2 && !["con", "para", "los", "las", "del", "que", "una", "por"].includes(t))
        .map(stem),
    ),
  ];
}

function stem(t: string) {
  if (t.length > 5 && t.endsWith("es")) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith("s")) return t.slice(0, -1);
  return t;
}

export const isHomeUrl = (u: string) => {
  try {
    return new URL(u).pathname.replace(/\/+$/, "") === "";
  } catch {
    return false;
  }
};

export type PageCandidate = { url: string; title: string | null; h1: string[] };

/**
 * Puntaje de calce: cuántos tokens de la keyword aparecen en la ruta (pesa más), el H1 y el title.
 * La página de inicio se penaliza: casi nunca es la mejor URL para una keyword específica.
 */
export function scorePage(kw: string[], p: PageCandidate): number {
  if (!kw.length) return 0;
  let path = "";
  try {
    path = new URL(p.url).pathname;
  } catch {
    return 0;
  }
  const inPath = new Set(kwTokens(path.replace(/[-_/]/g, " ")));
  const inH1 = new Set(kwTokens(p.h1.join(" ")));
  const inTitle = new Set(kwTokens(p.title ?? ""));
  let s = 0;
  let hits = 0;
  for (const t of kw) {
    const hit = inPath.has(t) || inH1.has(t) || inTitle.has(t);
    if (hit) hits++;
    s += (inPath.has(t) ? 3 : 0) + (inH1.has(t) ? 2 : 0) + (inTitle.has(t) ? 1 : 0);
  }
  if (!hits) return 0;
  // calce parcial vale menos: con 1 de 3 palabras no basta para recomendar
  s *= hits / kw.length;
  if (isHomeUrl(p.url)) s *= 0.3;
  return Math.round(s * 10) / 10;
}

export type Suggestion = { url: string; title: string | null; score: number; home: boolean; impressions?: number; source: "crawl" | "gsc" };

export async function pageSuggestions(projectId: string, keyword: string, limit = 5): Promise<{ suggestions: Suggestion[]; crawled: boolean }> {
  const kw = kwTokens(keyword);
  if (!kw.length) return { suggestions: [], crawled: false };
  const crawl = await db.crawl.findFirst({ where: { projectId, status: { in: ["completed", "partial"] } }, orderBy: { startedAt: "desc" }, select: { id: true } });
  const out = new Map<string, Suggestion>();
  if (crawl) {
    const pages = await db.page.findMany({
      where: { crawlId: crawl.id, status: 200, noindex: false },
      select: { url: true, title: true, h1: true, canonicalType: true },
      take: 5000,
    });
    for (const p of pages) {
      if (p.canonicalType === "other") continue;
      const score = scorePage(kw, p);
      if (score > 0) out.set(p.url, { url: p.url, title: p.title, score, home: isHomeUrl(p.url), source: "crawl" });
    }
  }
  // Search Console: páginas que ya aparecen en Google para consultas que contienen la keyword
  const words = strip(keyword).trim().split(/\s+/).filter((w) => w.length > 2);
  if (words.length) {
    const rows = await db.gscRow.groupBy({
      by: ["page"],
      where: { projectId, date: { gte: new Date(Date.now() - 90 * 864e5) }, AND: words.map((w) => ({ query: { contains: w, mode: "insensitive" as const } })) },
      _sum: { impressions: true },
      orderBy: { _sum: { impressions: "desc" } },
      take: limit,
    });
    for (const r of rows) {
      const imp = r._sum.impressions ?? 0;
      const prev = out.get(r.page);
      if (prev) prev.impressions = imp;
      else out.set(r.page, { url: r.page, title: null, score: 2, home: isHomeUrl(r.page), impressions: imp, source: "gsc" });
    }
  }
  // solo las que calzan casi tan bien como la mejor (evita sugerir /camas-montessori para «torre montessori»)
  const best = Math.max(0, ...[...out.values()].filter((x) => !x.home).map((x) => x.score));
  for (const [k, v] of out) if (v.source === "crawl" && !v.home && v.score < best * 0.6) out.delete(k);
  const suggestions = [...out.values()].sort((a, b) => Number(a.home) - Number(b.home) || b.score - a.score || (b.impressions ?? 0) - (a.impressions ?? 0)).slice(0, limit);
  return { suggestions, crawled: !!crawl };
}
