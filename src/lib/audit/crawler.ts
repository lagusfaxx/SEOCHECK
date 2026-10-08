import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { db } from "../db";
import { env } from "../env";
import { jobProgress } from "../queue";
import { assertUrlAllowed, safeFetch, SsrfError } from "../net/ssrf";
import { DEFAULT_IGNORE_PARAMS, detectWaf, PatternLimiter, stripParams } from "./guards";
import { hostOf, normUrl } from "../util";
import { computeIssues } from "./issues";
import { fetchSitemapUrls, parseRobots, type Robots } from "./robots";

export type CrawlOptions = {
  maxPages?: number;
  concurrency?: number;
  render?: boolean;
  startUrl?: string;
  maxDepth?: number;
  /** UA del crawl; si no viene, settings.crawler.userAgent del proyecto o CRAWLER_UA */
  userAgent?: string;
  /** Máx. de URLs por patrón de path (trampas de facetas/paginación). 0 = sin límite */
  maxPerPattern?: number;
  /** Parámetros de query a ignorar al descubrir URLs (`*` = todos, `utm_*` = comodín) */
  ignoreParams?: string[];
};

export type PageError = "blocked_by_waf" | "ssrf_blocked" | "fetch_failed";

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
  /** Bloques de texto (párrafos, ítems, celdas…) para separar texto editorial de navegación/tarjetas */
  blocks: TextBlock[];
  /** Señales para clasificar el tipo de página */
  signals: PageSignals;
  error?: PageError;
};

export type TextBlock = {
  t: string;
  /** palabras */
  w: number;
  /** fracción del texto que está dentro de links (tarjetas/menús ≈ 1) */
  link: number;
  /** dentro de nav/header/footer/aside/form o similar */
  chrome: boolean;
  tag: string;
};

export type PageSignals = {
  /** máx. de links internos que comparten patrón de URL (tarjetas de un listado) */
  linkGroup: number;
  article: boolean;
  time: boolean;
  cart: boolean;
  price: boolean;
};

export type FetchOpts = { userAgent?: string };

/** Error que no vale la pena reintentar (el sitio no responde, cancelado…): el worker no reintenta. */
export class NoRetryError extends Error {
  noRetry = true;
}

export type CrawlOutcome = { status: "completed" | "partial" | "failed"; reason: string | null };
type OutcomePage = { url: string; finalUrl: string; status: number; error?: PageError | null; contentType: string | null; robotsBlocked?: boolean };

/**
 * Resultado honesto del crawl: si no se pudo leer el sitio, es "fallido" (sin puntaje);
 * si se leyó solo en parte (WAF, muchos timeouts/5xx, home caída), es "parcial" con el motivo.
 */
export function classifyCrawl(o: { pages: OutcomePage[]; start: string; wafAbort: boolean; startError?: string | null }): CrawlOutcome {
  const pages = o.pages.filter((p) => !p.robotsBlocked);
  const ok = pages.filter((p) => p.status >= 200 && p.status < 300 && !p.error && (p.contentType ?? "").includes("html"));
  const startP = pages.find((p) => p.url === o.start) ?? pages[0];
  const why = (p: OutcomePage | undefined) => {
    if (!p) return "no se obtuvo ninguna respuesta";
    if (p.error === "ssrf_blocked") return o.startError ? `bloqueado por seguridad: ${o.startError}` : "la dirección resuelve a una red interna o no permitida";
    if (p.error === "blocked_by_waf") return `el firewall del sitio (Cloudflare u otro) bloqueó al crawler (HTTP ${p.status})`;
    if (p.status === 0) return `no se pudo conectar${o.startError ? `: ${o.startError}` : " (DNS, timeout o conexión rechazada)"}`;
    if (p.status >= 400) return `el sitio respondió HTTP ${p.status}`;
    if (!(p.contentType ?? "").includes("html")) return `la página de inicio no es HTML (${p.contentType ?? "sin tipo"})`;
    return "respuesta inválida";
  };
  if (!ok.length) return { status: "failed", reason: `No se pudo acceder al sitio: ${why(startP)}.` };
  const failed = pages.filter((p) => p.status === 0 || p.status >= 500 || p.error === "blocked_by_waf" || p.error === "fetch_failed");
  if (o.wafAbort) return { status: "partial", reason: `El firewall del sitio empezó a bloquear al crawler: se leyeron ${ok.length} de ${pages.length} URLs.` };
  if (pages.length >= 5 && failed.length / pages.length > 0.3) return { status: "partial", reason: `${failed.length} de ${pages.length} URLs no respondieron (timeouts, errores 5xx o bloqueos).` };
  if (startP && !ok.includes(startP) && (startP.status === 0 || startP.status >= 500)) return { status: "partial", reason: `La página de inicio falló (${why(startP)}); el resto se leyó desde el sitemap.` };
  return { status: "completed", reason: null };
}

async function fetchFollow(url: string, o: FetchOpts = {}) {
  const t0 = Date.now();
  const { res, finalUrl, redirects } = await safeFetch(url, { headers: { "User-Agent": o.userAgent || env.userAgent, Accept: "text/html,*/*" }, timeoutMs: 25000 });
  const ct = res.headers.get("content-type");
  const isText = ct?.includes("html") || res.status === 403 || res.status === 503 || res.status === 429;
  const html = isText ? await res.text() : (await res.body?.cancel().catch(() => {}), "");
  const waf = detectWaf(res.status, res.headers, html);
  return { status: res.status, finalUrl, redirects, contentType: ct, html: waf ? "" : html, waf, ms: Date.now() - t0, xRobots: res.headers.get("x-robots-tag") };
}

let browserP: Promise<any> | null = null;
const SKIP_TYPES = new Set(["image", "media", "font"]);

/**
 * Render con Chromium remoto. Todas las requests del navegador se interceptan y se resuelven
 * desde el worker con safeFetch (validación SSRF + IP fijada); el navegador nunca sale a la red.
 */
async function renderHtml(url: string, o: FetchOpts = {}): Promise<string | null> {
  if (!env.browserWs) return null;
  try {
    assertUrlAllowed(url);
    if (!browserP) {
      const { chromium } = await import("playwright-core");
      browserP = chromium.connectOverCDP(env.browserWs);
    }
    const browser = await browserP;
    const ctx = await browser.newContext({ userAgent: o.userAgent || env.userAgent, serviceWorkers: "block" });
    try {
      await ctx.routeWebSocket(/.*/, (ws: any) => ws.close());
      await ctx.route("**/*", async (route: any) => {
        const req = route.request();
        if (SKIP_TYPES.has(req.resourceType())) return route.abort();
        try {
          const { res } = await safeFetch(req.url(), {
            method: req.method(),
            headers: { ...req.headers(), "user-agent": o.userAgent || env.userAgent },
            body: req.postDataBuffer() ?? undefined,
            timeoutMs: 20000,
          });
          const headers: Record<string, string> = {};
          res.headers.forEach((v, k) => { if (!["content-encoding", "content-length", "transfer-encoding"].includes(k)) headers[k] = v; });
          await route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
        } catch {
          await route.abort("blockedbyclient");
        }
      });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      return await page.content();
    } finally {
      await ctx.close().catch(() => {});
    }
  } catch (e) {
    browserP = null;
    console.warn("[render]", e);
    return null;
  }
}

const BLOCK_TAGS = new Set("p,li,ul,ol,dl,h1,h2,h3,h4,h5,h6,td,th,tr,table,dd,dt,figcaption,figure,blockquote,pre,button,label,summary,details,caption,div,section,article,main,header,footer,nav,aside,form".split(","));
const CHROME_TAGS = new Set(["nav", "header", "footer", "aside", "form", "dialog"]);
const CHROME_ROLES = new Set(["navigation", "banner", "contentinfo", "dialog", "alertdialog"]);
const SKIP_TAGS = new Set(["script", "style", "noscript", "svg", "template", "video", "audio", "iframe", "object", "embed", "canvas", "select", "option"]);
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

type El = { type: string; name?: string; attribs?: Record<string, string>; children?: El[]; data?: string };
const isChromeEl = (e: El) =>
  CHROME_TAGS.has(e.name!) || CHROME_ROLES.has(e.attribs?.role ?? "") || e.attribs?.["aria-modal"] === "true" || e.attribs?.["aria-hidden"] === "true";

/**
 * Segmenta el body en bloques de texto: cada elemento de bloque corta el texto, así el texto suelto dentro de
 * contenedores (no solo el de los bloques "hoja") también queda en algún bloque.
 */
export function textBlocks($: cheerio.CheerioAPI): TextBlock[] {
  const out: TextBlock[] = [];
  const root = $("body").get(0) as unknown as El | undefined;
  if (!root) return out;
  type Cur = { parts: string[]; linkLen: number; chrome: boolean; tag: string };
  const emit = (c: Cur) => {
    const t = norm(c.parts.join(""));
    if (t) out.push({ t, w: t.split(" ").length, link: Math.min(1, c.linkLen / t.length), chrome: c.chrome, tag: c.tag });
    c.parts = [];
    c.linkLen = 0;
  };
  const walk = (node: El, cur: Cur, inLink: boolean) => {
    for (const ch of node.children ?? []) {
      if (ch.type === "text") {
        cur.parts.push(ch.data ?? "");
        if (inLink) cur.linkLen += norm(ch.data ?? "").length;
        continue;
      }
      if (ch.type !== "tag" && ch.type !== "script" && ch.type !== "style") continue;
      const tag = ch.name ?? "";
      if (SKIP_TAGS.has(tag)) continue;
      const chrome = cur.chrome || isChromeEl(ch);
      const link = inLink || tag === "a";
      if (BLOCK_TAGS.has(tag)) {
        emit(cur);
        const inner: Cur = { parts: [], linkLen: 0, chrome, tag };
        walk(ch, inner, link);
        emit(inner);
      } else {
        // inline dentro de un bloque: si abre zona de navegación (p. ej. <span role=navigation>) igual se marca
        if (chrome && !cur.chrome) {
          emit(cur);
          const inner: Cur = { parts: [], linkLen: 0, chrome, tag: cur.tag };
          walk(ch, inner, link);
          emit(inner);
        } else walk(ch, cur, link);
      }
    }
  };
  const top: Cur = { parts: [], linkLen: 0, chrome: false, tag: "body" };
  walk(root, top, false);
  emit(top);
  return out;
}

/** Links fuera de menús/footer/sidebars: los del contenido (tarjetas, listados). */
function contentLinks($: cheerio.CheerioAPI, url: string): string[] {
  const out: string[] = [];
  $("a[href]").each((_, el) => {
    const $el = $(el);
    if ($el.closest("nav,header,footer,aside,form,dialog,[role=navigation],[role=banner],[role=contentinfo]").length) return;
    const u = normUrl($el.attr("href")!, url);
    if (u) out.push(u);
  });
  return out;
}

/** Firma de plantilla de una URL: los segmentos variables (slugs con números, ids) pasan a "*". */
function templateSig(u: string): string | null {
  try {
    const segs = new URL(u).pathname.split("/").filter(Boolean);
    if (!segs.length) return null;
    return segs.map((s, i) => (i === segs.length - 1 && segs.length > 1 && /^index\.\w+$/.test(s) ? s : /\d/.test(s) || (s.match(/[-_]/g) ?? []).length >= 2 ? "*" : s)).join("/");
  } catch {
    return null;
  }
}

function pageSignals($: cheerio.CheerioAPI, url: string): PageSignals {
  const host = hostOf(url);
  const groups = new Map<string, Set<string>>();
  for (const l of contentLinks($, url)) {
    if (hostOf(l) !== host) continue;
    const sig = templateSig(l);
    // tarjetas: muchas URLs distintas con la misma plantilla (un slug variable)
    if (!sig || !sig.includes("*")) continue;
    if (!groups.has(sig)) groups.set(sig, new Set());
    groups.get(sig)!.add(l);
  }
  const bodyText = $("body").text();
  return {
    linkGroup: Math.max(0, ...[...groups.values()].map((g) => g.size)),
    article: $("article").length === 1,
    time: $("time[datetime]").length > 0,
    cart: /(agregar|añadir|anadir)\s+al\s+(carro|carrito)|add to (cart|basket)|comprar ahora/i.test(bodyText),
    price: /(\$|clp|usd|us\$)\s?\d{1,3}([.,]\d{3})+|precio/i.test(bodyText),
  };
}

/** Mensaje entendible para un error de red (DNS, timeout, TLS, SSRF). */
export function describeFetchError(e: unknown): string {
  const err = e as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } };
  const code = err?.cause?.code ?? err?.code ?? "";
  if (err?.name === "SsrfError") return err.message ?? "bloqueado por seguridad";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "el dominio no resuelve (DNS)";
  if (code === "ECONNREFUSED") return "conexión rechazada";
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") return "la conexión se cortó";
  if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT" || err?.name === "TimeoutError" || err?.name === "AbortError") return "tiempo de espera agotado";
  if (/CERT|SSL|TLS/i.test(code) || /certificate/i.test(err?.cause?.message ?? err?.message ?? "")) return `certificado TLS inválido (${code || "TLS"})`;
  return (err?.cause?.message ?? err?.message ?? String(e)).slice(0, 160);
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
  // fuera: código y los textos de respaldo de medios ("tu navegador no soporta video…")
  $("script,style,noscript,svg,template,video,audio,iframe,object,embed,canvas,picture source").remove();
  const signals = pageSignals($, url);
  const blocks = textBlocks($);
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
    blocks,
    signals,
    hash: text ? createHash("sha1").update(text.toLowerCase()).digest("hex") : null,
  };
}

export async function fetchPage(url: string, render = false, o: FetchOpts = {}): Promise<PageData> {
  const r = await fetchFollow(url, o);
  let html = r.html;
  if (render && r.status === 200 && html) html = (await renderHtml(r.finalUrl, o)) ?? html;
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
    blocks: parsed?.blocks ?? [],
    signals: parsed?.signals ?? { linkGroup: 0, article: false, time: false, cart: false, price: false },
    error: r.waf ? "blocked_by_waf" : undefined,
  };
}

/** Crawl BFS con concurrencia limitada. */
export async function runCrawl(crawlId: string, jobRunId?: string) {
  const crawl = await db.crawl.findUniqueOrThrow({ where: { id: crawlId }, include: { project: true } });
  const projectCrawler = ((crawl.project.settings ?? {}) as Record<string, any>).crawler ?? {};
  const o: CrawlOptions = {
    maxPages: 500, concurrency: 5, render: false, maxDepth: 20, maxPerPattern: 50, ignoreParams: DEFAULT_IGNORE_PARAMS,
    ...projectCrawler,
    ...(crawl.options as CrawlOptions),
  };
  const ua = o.userAgent || env.userAgent;
  const patterns = new PatternLimiter(o.maxPerPattern ?? 0);
  const clean = (u: string) => normUrl(stripParams(u, o.ignoreParams ?? []))!;
  let wafStreak = 0;
  let wafAbort = false;
  const domain = crawl.project.domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const start = normUrl(o.startUrl || `https://${domain}/`)!;
  const site = hostOf(start);
  const origin = new URL(start).origin;
  if (crawl.status === "cancelled") throw new NoRetryError("Crawl cancelado antes de empezar");
  await db.crawl.update({ where: { id: crawlId }, data: { status: "running", reason: null } });

  // robots + sitemap
  await jobProgress(jobRunId, 1, "robots.txt");
  let robots: Robots = { disallow: [], allow: [], sitemaps: [] };
  let robotsTxt: string | null = null;
  try {
    const { res: r } = await safeFetch(`${origin}/robots.txt`, { headers: { "User-Agent": ua } });
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

  let startError: string | null = null;
  // cancelación: el usuario puede cancelar el trabajo; se revisa entre tandas
  let lastCheck = 0;
  const cancelled = async () => {
    if (Date.now() - lastCheck < 3000) return false;
    lastCheck = Date.now();
    const c = await db.crawl.findUnique({ where: { id: crawlId }, select: { status: true } });
    return c?.status === "cancelled";
  };
  const seen = new Map<string, number>(); // url → depth
  const pages: PageData[] = [];
  const external = new Set<string>();
  let queue = [start];
  seen.set(start, 0);
  const limit = pLimit(o.concurrency!);
  let depth = 0;
  while (queue.length && pages.length < o.maxPages! && depth <= o.maxDepth! && !wafAbort) {
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
            pd = await fetchPage(u, o.render, { userAgent: ua });
          } catch (e) {
            pd = { ...emptyPage(u), error: e instanceof SsrfError ? "ssrf_blocked" : "fetch_failed" };
            if (u === start) startError = describeFetchError(e);
          }
          pages.push({ ...pd, blocks: [] }); // los bloques solo los usa Contenido: no acumularlos en crawls grandes
          // Si el WAF bloquea todo, no seguir golpeando el sitio
          wafStreak = pd.error === "blocked_by_waf" ? wafStreak + 1 : 0;
          if (wafStreak >= 15) wafAbort = true;
          if (pd.finalUrl !== u && isInternal(pd.finalUrl) && !seen.has(pd.finalUrl)) {
            seen.set(pd.finalUrl, depth);
            next.push(pd.finalUrl);
          }
          for (const raw of pd.links) {
            if (!isInternal(raw)) {
              external.add(raw);
              continue;
            }
            const l = clean(raw);
            if (skipExt.test(l) || seen.has(l)) continue;
            if (!patterns.allow(l)) continue;
            seen.set(l, depth + 1);
            next.push(l);
          }
          if (pages.length % 10 === 0) await jobProgress(jobRunId, 5 + (pages.length / o.maxPages!) * 80, `${pages.length} urls`);
        })
      )
    );
    queue = next;
    depth++;
    if (await cancelled()) throw new NoRetryError("Crawl cancelado");
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
          const pd = await fetchPage(u, false, { userAgent: ua });
          pages.push({ ...pd, blocks: [] });
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
    blocked: p.status === 0 && !p.error && blocked(p.url),
    error: p.error ?? null,
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
    blockedByWaf: saved.filter((p) => p.error === "blocked_by_waf").length,
    wafAborted: wafAbort,
    trapSkipped: [...patterns.skipped.values()].reduce((a, b) => a + b, 0),
    trapPatterns: [...patterns.skipped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([pattern, skipped]) => ({ pattern, skipped })),
    orphans: orphans.length,
    sitemap: sitemapUrls.size,
    external: external.size,
    critical: sev("critical"),
    warning: sev("warning"),
    info: sev("info"),
    avgMs: Math.round(saved.reduce((s, p) => s + p.responseMs, 0) / Math.max(1, saved.length)),
    health: Math.max(0, Math.round(100 - (sev("critical") * 5 + sev("warning")) / Math.max(1, saved.length) * 10)) as number | null,
    /** cobertura: páginas leídas por links vs. el máximo pedido */
    limitReached: Boolean(o.maxPages && pages.length - Math.min(orphans.length, 300) >= o.maxPages),
  };
  const outcome = classifyCrawl({
    pages: pages.map((p) => ({ url: p.url, finalUrl: p.finalUrl, status: p.status, error: p.error ?? null, contentType: p.contentType, robotsBlocked: p.status === 0 && !p.error && blocked(p.url) })),
    start,
    wafAbort,
    startError,
  });
  // sin acceso al sitio no hay puntaje: un 70/100 de algo que no se leyó sería falso
  if (outcome.status === "failed") stats.health = null;
  if (await cancelled()) throw new NoRetryError("Crawl cancelado");
  await db.crawl.update({ where: { id: crawlId }, data: { status: outcome.status, reason: outcome.reason, stats, finishedAt: new Date() } });
  if (outcome.status === "failed") throw new NoRetryError(outcome.reason ?? "Crawl fallido");
  return { ...stats, status: outcome.status };
}

function emptyPage(url: string): PageData {
  return {
    url, finalUrl: url, status: 0, redirects: [], contentType: null, title: null, metaDesc: null, h1: [], canonical: null,
    canonicalType: "none", noindex: false, hreflang: [], jsonldTypes: [], jsonldErrors: 0, wordCount: 0, imgNoAlt: 0,
    links: [], responseMs: 0, contentHash: null, text: "", headings: [], blocks: [],
    signals: { linkGroup: 0, article: false, time: false, cart: false, price: false },
  };
}
