import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { db } from "../db";
import { env } from "../env";
import { jobProgress } from "../queue";
import { fetchT, hostOf, normUrl } from "../util";
import { computeIssues } from "./issues";
import { fetchSitemapUrls, parseRobots, type Robots } from "./robots";

export type CrawlOptions = { maxPages?: number; concurrency?: number; render?: boolean; startUrl?: string; maxDepth?: number };

export type PageData = {
  url: string;
  finalUrl: string;
  status: number;
  redirects: { url: string; status: number }[];
  contentType: string | null;
  title: string | null;
  metaDesc: string | null;
  h1: string[];
  canonical: string | null;
  canonicalType: "self" | "other" | "none";
  noindex: boolean;
  hreflang: { lang: string; href: string }[];
  jsonldTypes: string[];
  jsonldErrors: number;
  wordCount: number;
  imgNoAlt: number;
  links: string[];
  responseMs: number;
  contentHash: string | null;
  text: string;
  headings: { tag: string; text: string }[];
};

async function fetchFollow(url: string) {
  const redirects: { url: string; status: number }[] = [];
  let cur = url;
  const t0 = Date.now();
  for (let i = 0; i < 10; i++) {
    const res = await fetchT(cur, { redirect: "manual", headers: { "User-Agent": env.userAgent, Accept: "text/html,*/*" }, timeoutMs: 25000 });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      redirects.push({ url: cur, status: res.status });
      const next = normUrl(res.headers.get("location")!, cur);
      await res.body?.cancel().catch(() => {});
      if (!next) break;
      cur = next;
      continue;
    }
    const ct = res.headers.get("content-type");
    const html = ct?.includes("html") ? await res.text() : (await res.body?.cancel().catch(() => {}), "");
    return { status: res.status, finalUrl: cur, redirects, contentType: ct, html, ms: Date.now() - t0, xRobots: res.headers.get("x-robots-tag") };
  }
  return { status: 310, finalUrl: cur, redirects, contentType: null, html: "", ms: Date.now() - t0, xRobots: null };
}

let browserP: Promise<any> | null = null;
async function renderHtml(url: string): Promise<string | null> {
  if (!env.browserWs) return null;
  try {
    if (!browserP) {
      const { chromium } = await import("playwright-core");
      browserP = chromium.connectOverCDP(env.browserWs);
    }
    const browser = await browserP;
    const ctx = browser.contexts()[0] ?? (await browser.newContext({ userAgent: env.userAgent }));
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      return await page.content();
    } finally {
      await page.close();
    }
  } catch (e) {
    browserP = null;
    console.warn("[render]", e);
    return null;
  }
}

export function parseHtml(html: string, url: string) {
  const $ = cheerio.load(html);
  const canonicalRaw = $('link[rel="canonical"]').attr("href");
  const canonical = canonicalRaw ? normUrl(canonicalRaw, url) : null;
  const robotsMeta = ($('meta[name="robots"]').attr("content") ?? "") + " " + ($('meta[name="googlebot"]').attr("content") ?? "");
  const jsonldTypes: string[] = [];
  let jsonldErrors = 0;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      const walk = (n: any) => {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) return n.forEach(walk);
        if (n["@type"]) jsonldTypes.push(...[].concat(n["@type"]));
        if (n["@graph"]) walk(n["@graph"]);
      };
      walk(data);
    } catch {
      jsonldErrors++;
    }
  });
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    const rel = $(el).attr("rel") ?? "";
    const u = normUrl($(el).attr("href")!, url);
    if (u && !rel.includes("nofollow")) links.add(u);
  });
  const headings: { tag: string; text: string }[] = [];
  $("h1,h2,h3").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t) headings.push({ tag: el.tagName.toLowerCase(), text: t });
  });
  const imgNoAlt = $("img").filter((_, el) => !($(el).attr("alt") ?? "").trim()).length;
  $("script,style,noscript,svg,template").remove();
  const body = $("main").length ? $("main") : $("body");
  const text = body.text().replace(/\s+/g, " ").trim();
  return {
    title: $("title").first().text().trim() || null,
    metaDesc: $('meta[name="description"]').attr("content")?.trim() || null,
    h1: $("h1").map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).get(),
    canonical,
    canonicalType: (!canonical ? "none" : canonical === url ? "self" : "other") as PageData["canonicalType"],
    noindex: /noindex/i.test(robotsMeta),
    hreflang: $('link[rel="alternate"][hreflang]').map((_, el) => ({ lang: $(el).attr("hreflang")!, href: $(el).attr("href")! })).get(),
    jsonldTypes: [...new Set(jsonldTypes)],
    jsonldErrors,
    wordCount: text ? text.split(" ").length : 0,
    imgNoAlt,
    links: [...links],
    text,
    headings,
    hash: text ? createHash("sha1").update(text.toLowerCase()).digest("hex") : null,
  };
}

export async function fetchPage(url: string, render = false): Promise<PageData> {
  const r = await fetchFollow(url);
  let html = r.html;
  if (render && r.status === 200 && html) html = (await renderHtml(r.finalUrl)) ?? html;
  const parsed = html ? parseHtml(html, r.finalUrl) : null;
  return {
    url,
    finalUrl: r.finalUrl,
    status: r.status,
    redirects: r.redirects,
    contentType: r.contentType,
    title: parsed?.title ?? null,
    metaDesc: parsed?.metaDesc ?? null,
    h1: parsed?.h1 ?? [],
    canonical: parsed?.canonical ?? null,
    canonicalType: parsed?.canonicalType ?? "none",
    noindex: (parsed?.noindex ?? false) || /noindex/i.test(r.xRobots ?? ""),
    hreflang: parsed?.hreflang ?? [],
    jsonldTypes: parsed?.jsonldTypes ?? [],
    jsonldErrors: parsed?.jsonldErrors ?? 0,
    wordCount: parsed?.wordCount ?? 0,
    imgNoAlt: parsed?.imgNoAlt ?? 0,
    links: parsed?.links ?? [],
    responseMs: r.ms,
    contentHash: parsed?.hash ?? null,
    text: parsed?.text ?? "",
    headings: parsed?.headings ?? [],
  };
}

/** Crawl BFS con concurrencia limitada. */
export async function runCrawl(crawlId: string, jobRunId?: string) {
  const crawl = await db.crawl.findUniqueOrThrow({ where: { id: crawlId }, include: { project: true } });
  const o: CrawlOptions = { maxPages: 500, concurrency: 5, render: false, maxDepth: 20, ...(crawl.options as CrawlOptions) };
  const domain = crawl.project.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const start = normUrl(o.startUrl || `https://${domain}/`)!;
  const site = hostOf(start);
  const origin = new URL(start).origin;
  await db.crawl.update({ where: { id: crawlId }, data: { status: "running" } });

  // robots + sitemap
  await jobProgress(jobRunId, 1, "robots.txt");
  let robots: Robots = { disallow: [], allow: [], sitemaps: [] };
  let robotsTxt: string | null = null;
  try {
    const r = await fetchT(`${origin}/robots.txt`, { headers: { "User-Agent": env.userAgent } });
    if (r.ok) {
      robotsTxt = await r.text();
      robots = parseRobots(robotsTxt);
    }
  } catch {}
  await jobProgress(jobRunId, 3, "sitemap.xml");
  const sitemapList = robots.sitemaps.length ? robots.sitemaps : [`${origin}/sitemap.xml`];
  const sitemapUrls = new Set((await fetchSitemapUrls(sitemapList, 20000)).map((u) => normUrl(u)).filter(Boolean) as string[]);
  await db.crawl.update({ where: { id: crawlId }, data: { robots: robotsTxt, sitemapUrls: sitemapUrls.size } });

  const isInternal = (u: string) => hostOf(u) === site;
  const blocked = (u: string) => {
    const path = new URL(u).pathname;
    const a = robots.allow.filter((r) => path.startsWith(r)).sort((x, y) => y.length - x.length)[0] ?? "";
    const d = robots.disallow.filter((r) => path.startsWith(r)).sort((x, y) => y.length - x.length)[0] ?? "";
    return d.length > a.length;
  };
  const skipExt = /\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3|css|js|ico|woff2?|xml|json)(\?|$)/i;

  const seen = new Map<string, number>(); // url → depth
  const pages: PageData[] = [];
  const external = new Set<string>();
  let queue = [start];
  seen.set(start, 0);
  const limit = pLimit(o.concurrency!);
  let depth = 0;
  while (queue.length && pages.length < o.maxPages! && depth <= o.maxDepth!) {
    const batch = queue.slice(0, o.maxPages! - pages.length);
    const next: string[] = [];
    await Promise.all(
      batch.map((u) =>
        limit(async () => {
          if (blocked(u)) {
            pages.push({ ...emptyPage(u), status: 0 } as PageData);
            return;
          }
          let pd: PageData;
          try {
            pd = await fetchPage(u, o.render);
          } catch {
            pd = emptyPage(u);
          }
          pages.push(pd);
          if (pd.finalUrl !== u && isInternal(pd.finalUrl) && !seen.has(pd.finalUrl)) {
            seen.set(pd.finalUrl, depth);
            next.push(pd.finalUrl);
          }
          for (const l of pd.links) {
            if (!isInternal(l)) {
              external.add(l);
              continue;
            }
            if (skipExt.test(l) || seen.has(l)) continue;
            seen.set(l, depth + 1);
            next.push(l);
          }
          if (pages.length % 10 === 0) await jobProgress(jobRunId, 5 + (pages.length / o.maxPages!) * 80, `${pages.length} urls`);
        })
      )
    );
    queue = next;
    depth++;
  }

  // Huérfanas: en sitemap pero no alcanzadas
  await jobProgress(jobRunId, 86, "huérfanas");
  const reached = new Set(pages.flatMap((p) => [p.url, p.finalUrl]));
  const orphans = [...sitemapUrls].filter((u) => !reached.has(u)).slice(0, 2000);
  const orphanLimit = Math.min(orphans.length, 300);
  await Promise.all(
    orphans.slice(0, orphanLimit).map((u) =>
      limit(async () => {
        try {
          const pd = await fetchPage(u, false);
          pages.push(pd);
          seen.set(u, -1);
        } catch {}
      })
    )
  );

  // Inlinks
  const inlinks = new Map<string, number>();
  for (const p of pages) for (const l of new Set(p.links)) inlinks.set(l, (inlinks.get(l) ?? 0) + 1);

  await jobProgress(jobRunId, 90, "guardando");
  await db.page.deleteMany({ where: { crawlId } });
  const orphanSet = new Set(orphans);
  const rows = pages.map((p) => ({
    crawlId,
    url: p.url,
    finalUrl: p.finalUrl,
    status: p.status,
    redirects: p.redirects,
    contentType: p.contentType,
    title: p.title,
    titleLen: p.title?.length ?? 0,
    metaDesc: p.metaDesc,
    metaLen: p.metaDesc?.length ?? 0,
    h1: p.h1,
    canonical: p.canonical,
    canonicalType: p.canonicalType,
    noindex: p.noindex,
    hreflang: p.hreflang,
    jsonldTypes: p.jsonldTypes,
    jsonldErrors: p.jsonldErrors,
    wordCount: p.wordCount,
    imgNoAlt: p.imgNoAlt,
    inlinks: inlinks.get(p.url) ?? 0,
    outlinks: p.links.length,
    links: p.links.filter(isInternal).slice(0, 500),
    responseMs: p.responseMs,
    depth: seen.get(p.url) ?? -1,
    contentHash: p.contentHash,
    inSitemap: sitemapUrls.has(p.url),
    orphan: orphanSet.has(p.url),
    blocked: p.status === 0 && blocked(p.url),
  }));
  for (let i = 0; i < rows.length; i += 200) await db.page.createMany({ data: rows.slice(i, i + 200), skipDuplicates: true });

  await jobProgress(jobRunId, 95, "issues");
  const saved = await db.page.findMany({ where: { crawlId } });
  const issues = computeIssues(saved, { robotsTxt, sitemapCount: sitemapUrls.size, site });
  await db.issue.deleteMany({ where: { crawlId } });
  for (let i = 0; i < issues.length; i += 500) await db.issue.createMany({ data: issues.slice(i, i + 500).map((x) => ({ ...x, crawlId })) });

  const sev = (s: string) => issues.filter((x) => x.severity === s).length;
  const stats = {
    pages: saved.length,
    ok: saved.filter((p) => p.status === 200).length,
    redirects: saved.filter((p) => p.redirects && (p.redirects as unknown[]).length).length,
    errors: saved.filter((p) => p.status >= 400 || p.status === 0).length,
    orphans: orphans.length,
    sitemap: sitemapUrls.size,
    external: external.size,
    critical: sev("critical"),
    warning: sev("warning"),
    info: sev("info"),
    avgMs: Math.round(saved.reduce((s, p) => s + p.responseMs, 0) / Math.max(1, saved.length)),
    health: Math.max(0, Math.round(100 - (sev("critical") * 5 + sev("warning")) / Math.max(1, saved.length) * 10)),
  };
  await db.crawl.update({ where: { id: crawlId }, data: { status: "done", stats, finishedAt: new Date() } });
  return stats;
}

function emptyPage(url: string): PageData {
  return {
    url, finalUrl: url, status: 0, redirects: [], contentType: null, title: null, metaDesc: null, h1: [], canonical: null,
    canonicalType: "none", noindex: false, hreflang: [], jsonldTypes: [], jsonldErrors: 0, wordCount: 0, imgNoAlt: 0,
    links: [], responseMs: 0, contentHash: null, text: "", headings: [],
  };
}
