import pLimit from "p-limit";
import { db } from "../db";
import { env } from "../env";
import { strip } from "../text";
import { normUrl } from "../util";
import { safeFetch } from "../net/ssrf";
import { fetchSitemapUrls, parseRobots, robotsAllows, type Robots } from "../audit/robots";
import { fetchPage } from "../audit/crawler";
import { classifyPage, type PageType } from "./clean";

/**
 * Páginas del propio sitio que calzan con una keyword, sin APIs pagadas ni créditos:
 * 1) páginas de la última auditoría y consultas de Search Console;
 * 2) si el proyecto todavía no tiene ninguna de las dos: robots.txt → sitemap(s), calce por slug y
 *    lectura de title/H1 solo de los mejores candidatos;
 * 3) sin sitemap útil: mini-crawl acotado desde la portada (solo para descubrir URLs, no es una auditoría).
 */

const STOP = new Set(["con", "para", "los", "las", "del", "que", "una", "por", "www", "html", "php"]);

/** Tokens comparables: sin tildes, sin palabras vacías cortas y con un singular aproximado ("balancines" → "balancin"). */
export function kwTokens(text: string): string[] {
  return [
    ...new Set(
      strip(text)
        .replace(/[^a-z0-9ñ]+/g, " ")
        .split(" ")
        .filter((t) => t.length > 2 && !STOP.has(t))
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
 * Puntaje de calce: tokens de la keyword en la ruta (pesa más), el H1 y el title.
 * La portada no se excluye: se penaliza cuando la keyword es específica (2+ palabras que no son la marca),
 * así puede ganar cuando realmente es la página más relevante (p. ej. la keyword es el nombre del negocio).
 */
export function scorePage(kw: string[], p: PageCandidate, brand: string[] = []): number {
  if (!kw.length) return 0;
  let path = "";
  try {
    path = new URL(p.url).pathname;
  } catch {
    return 0;
  }
  const inPath = new Set(kwTokens(path.replace(/[-_/.]/g, " ")));
  const inH1 = new Set(kwTokens(p.h1.join(" ")));
  const inTitle = new Set(kwTokens(p.title ?? ""));
  let s = 0;
  let hits = 0;
  for (const t of kw) {
    if (inPath.has(t) || inH1.has(t) || inTitle.has(t)) hits++;
    s += (inPath.has(t) ? 3 : 0) + (inH1.has(t) ? 2 : 0) + (inTitle.has(t) ? 1 : 0);
  }
  if (!hits) return 0;
  // calce parcial vale menos: con 1 de 3 palabras no basta para recomendar
  s *= hits / kw.length;
  if (isHomeUrl(p.url) && isSpecific(kw, brand)) s *= 0.35;
  return Math.round(s * 10) / 10;
}

/** Keyword específica: 2+ palabras y no es (solo) la marca del sitio. */
export function isSpecific(kw: string[], brand: string[] = []) {
  return kw.filter((t) => !brand.includes(t)).length >= 2;
}

/** Tokens de la marca a partir del dominio ("sin-tornillo.cl" → sin, tornillo, sintornillo). */
export const brandOf = (domain: string) => {
  const label = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split(".")[0];
  return [...new Set([...kwTokens(label.replace(/-/g, " ")), ...kwTokens(label.replace(/-/g, ""))])];
};

const ASSET = /\.(jpe?g|png|gif|webp|svg|pdf|zip|xml|txt|css|js|mp4|mp3|ico|woff2?)$/i;

export type Source = "crawl" | "gsc" | "sitemap" | "minicrawl";
export type Suggestion = { url: string; title: string | null; score: number; home: boolean; impressions?: number; source: Source };
export type SuggestResult = { suggestions: Suggestion[]; known: boolean; discovered: "sitemap" | "minicrawl" | null; scanned: number };

// ---------- descubrimiento (con caché: el formulario consulta en cada pausa al escribir) ----------

type Meta = { title: string | null; h1: string[]; type?: PageType };
const TTL = 30 * 60_000;
const urlCache = new Map<string, { at: number; p: Promise<{ urls: string[]; via: "sitemap" | "minicrawl" | null }> }>();
const metaCache = new Map<string, { at: number; m: Meta | null }>();

function sameSite(u: string, host: string) {
  try {
    const h = new URL(u).hostname.replace(/^www\./, "");
    return h === host || h.endsWith(`.${host}`);
  } catch {
    return false;
  }
}

/** title/H1 (y tipo de página) de una URL del sitio. Solo para candidatos: nunca para todo el sitemap. */
export async function pageMeta(url: string): Promise<Meta | null> {
  const c = metaCache.get(url);
  if (c && Date.now() - c.at < TTL) return c.m;
  let m: Meta | null = null;
  try {
    const p = await fetchPage(url);
    if (p.status === 200 && !p.noindex && (p.contentType ?? "").includes("html")) m = { title: p.title, h1: p.h1, type: classifyPage(url, p, p.wordCount) };
  } catch {}
  metaCache.set(url, { at: Date.now(), m });
  return m;
}

async function discoverUrls(domain: string): Promise<{ urls: string[]; via: "sitemap" | "minicrawl" | null }> {
  const host = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  const cached = urlCache.get(host);
  if (cached && Date.now() - cached.at < TTL) return cached.p;
  const p = (async () => {
    const origin = `https://${domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`;
    let robots: Robots = { disallow: [], allow: [], sitemaps: [], group: "" };
    try {
      const { res } = await safeFetch(`${origin}/robots.txt`, { headers: { "User-Agent": env.userAgent }, timeoutMs: 8000 });
      if (res.ok) robots = parseRobots(await res.text());
    } catch {}
    const list = robots.sitemaps.length ? robots.sitemaps : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
    const fromSitemap = (await fetchSitemapUrls(list, 5000, { maxSitemaps: 12, timeoutMs: 10000 }).catch(() => []))
      .map((u) => normUrl(u))
      .filter((u): u is string => !!u && sameSite(u, host) && !ASSET.test(new URL(u).pathname));
    if (fromSitemap.length) return { urls: [...new Set(fromSitemap)], via: "sitemap" as const };
    return { urls: await miniCrawl(origin, host, robots), via: "minicrawl" as const };
  })();
  urlCache.set(host, { at: Date.now(), p });
  // un fallo de red no debe quedar cacheado 30 minutos
  p.then((r) => { if (!r.urls.length) urlCache.delete(host); }).catch(() => urlCache.delete(host));
  return p;
}

/**
 * Mini-crawl solo para descubrir candidatos: portada + 2 niveles, máx. 40 páginas, respeta robots.txt.
 * No guarda nada ni calcula problemas: es mucho más liviano que la auditoría.
 */
async function miniCrawl(origin: string, host: string, robots: Robots, max = 40): Promise<string[]> {
  const seen = new Set<string>();
  const found: string[] = [];
  let frontier = [normUrl(origin + "/")!];
  const limit = pLimit(4);
  for (let depth = 0; depth <= 2 && frontier.length && found.length < max; depth++) {
    const batch = frontier.filter((u) => !seen.has(u)).slice(0, max - found.length);
    batch.forEach((u) => seen.add(u));
    const next: string[] = [];
    await Promise.all(
      batch.map((u) =>
        limit(async () => {
          try {
            const p = await fetchPage(u);
            if (p.status !== 200 || !(p.contentType ?? "").includes("html")) return;
            found.push(p.finalUrl || u);
            metaCache.set(p.finalUrl || u, { at: Date.now(), m: p.noindex ? null : { title: p.title, h1: p.h1, type: classifyPage(u, p, p.wordCount) } });
            for (const l of p.links) if (sameSite(l, host) && !seen.has(l) && !ASSET.test(new URL(l).pathname) && robotsAllows(robots, l)) next.push(l);
          } catch {}
        }),
      ),
    );
    frontier = [...new Set(next)];
  }
  return found;
}

// ---------- sugerencias ----------

export async function pageSuggestions(projectId: string, keyword: string, limit = 5): Promise<SuggestResult> {
  const kw = kwTokens(keyword);
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { domain: true } });
  const brand = brandOf(project.domain);
  if (!kw.length) return { suggestions: [], known: false, discovered: null, scanned: 0 };
  const crawl = await db.crawl.findFirst({ where: { projectId, status: { in: ["completed", "partial"] } }, orderBy: { startedAt: "desc" }, select: { id: true } });
  const out = new Map<string, Suggestion>();
  let scanned = 0;
  if (crawl) {
    const pages = await db.page.findMany({
      where: { crawlId: crawl.id, status: 200, noindex: false },
      select: { url: true, title: true, h1: true, canonicalType: true },
      take: 5000,
    });
    scanned = pages.length;
    for (const p of pages) {
      if (p.canonicalType === "other") continue;
      const score = scorePage(kw, p, brand);
      if (score > 0) out.set(p.url, { url: p.url, title: p.title, score, home: isHomeUrl(p.url), source: "crawl" });
    }
  }
  // Search Console: páginas que ya aparecen en Google para consultas que contienen la keyword
  const hasGsc = !!(await db.gscRow.findFirst({ where: { projectId }, select: { page: true } }));
  const words = strip(keyword).trim().split(/\s+/).filter((w) => w.length > 2);
  if (hasGsc && words.length) {
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

  // Proyecto nuevo, sin URLs conocidas: descubrir desde sitemap o mini-crawl
  let discovered: SuggestResult["discovered"] = null;
  const known = !!crawl || hasGsc;
  if (!known) {
    const { urls, via } = await discoverUrls(project.domain);
    discovered = via;
    scanned = urls.length;
    // 1) slugs primero (sin pedir nada al sitio). Del mini-crawl ya tenemos title/H1: se usan directamente.
    const metaOf = (url: string) => (via === "minicrawl" ? metaCache.get(url)?.m : null);
    const bySlug = urls
      .map((url) => {
        const m = metaOf(url);
        return { url, score: scorePage(kw, { url, title: m?.title ?? null, h1: m?.h1 ?? [] }, brand) };
      })
      .filter((c) => c.score > 0 || isHomeUrl(c.url))
      .sort((a, b) => b.score - a.score);
    // 2) title/H1 solo de los mejores candidatos (+ la portada, que puede ser la más relevante para la marca)
    const top = bySlug.filter((c) => c.score > 0).slice(0, 8);
    const home = bySlug.find((c) => isHomeUrl(c.url));
    if (home && !top.includes(home)) top.push(home);
    const lim = pLimit(4);
    await Promise.all(
      top.map((c) =>
        lim(async () => {
          const m = await pageMeta(c.url);
          if (!m) return;
          const score = scorePage(kw, { url: c.url, title: m.title, h1: m.h1 }, brand);
          if (score > 0) out.set(c.url, { url: c.url, title: m.title, score, home: isHomeUrl(c.url), source: via ?? "sitemap" });
        }),
      ),
    );
  }

  // solo las que calzan casi tan bien como la mejor (evita sugerir /camas-montessori para «torre montessori»)
  const best = Math.max(0, ...[...out.values()].filter((x) => x.source !== "gsc").map((x) => x.score));
  for (const [k, v] of out) if (v.source !== "gsc" && v.score < best * 0.6) out.delete(k);
  const suggestions = [...out.values()].sort((a, b) => b.score - a.score || (b.impressions ?? 0) - (a.impressions ?? 0)).slice(0, limit);
  return { suggestions, known, discovered, scanned };
}

/**
 * Después del análisis SERP: ¿el sitio tiene una página del tipo que Google prefiere para la keyword?
 * Clasifica (gratis, leyendo el propio sitio) los mejores candidatos que no son la URL analizada.
 */
export async function pageTypeFit(projectId: string, keyword: string, analyzedUrl: string, googleType: PageType) {
  const { suggestions } = await pageSuggestions(projectId, keyword, 6);
  const candidates = suggestions.filter((s) => normUrl(s.url) !== normUrl(analyzedUrl)).slice(0, 4);
  const typed: (Suggestion & { type: PageType | null })[] = [];
  const lim = pLimit(3);
  await Promise.all(candidates.map((c) => lim(async () => typed.push({ ...c, type: (await pageMeta(c.url))?.type ?? null }))));
  const match = typed.filter((c) => c.type === googleType).sort((a, b) => b.score - a.score)[0] ?? null;
  return { googleType, match, checked: typed.length };
}
