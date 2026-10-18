import { Prisma } from "@prisma/client";
import { classifyTemplate, type TemplateRule } from "./parse/template";
import { extractStructured } from "./parse/structured";
import { commerceSignals } from "./parse/commerce";
import { imageList } from "./parse/media";
import { mainText, mainHash, simhash } from "./parse/dup";
import { extractCustom, type ExtractRule } from "./parse/extract";
import { fetchSitemapEvidence } from "./sitemap";
import { RULES_VERSION } from "../report-rules";
import { crawlLimit } from "../plans";
import { syncCrawlTasks } from "../tasks";
import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { db } from "../db";
import { env } from "../env";
import { jobProgress } from "../queue";
import { assertUrlAllowed, RedirectLoopError, safeFetch, SsrfError } from "../net/ssrf";
import { DEFAULT_IGNORE_PARAMS, detectWaf, PatternLimiter, stripParams,
} from "./guards";
import { hostOf, normUrl } from "../util";
import { computeIssues, SLOW_MS } from "./issues";
import { detectCms, type Cms } from "./cms";
import { checkStructuredData } from "./structured";
import { fetchSitemapUrls, parseRobots, robotsAllows, type Robots,
} from "./robots";

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
  /** con render: solo estas rutas se renderizan ("/productos/*"); vacío = todas */
  renderPaths?: string[];
  /** credenciales cifradas (encrypt de gsc-oauth) de una auditoría privada */
  auth?: string;
  templates?: TemplateRule[];
  extract?: ExtractRule[];
};

export type PageError = "blocked_by_waf" | "ssrf_blocked" | "fetch_failed";

export type PageData = {
  evidence?: {
    robotsMeta: string;
    xRobots: string | null;
    headers: Record<string, string>;
    htmlSnippet: string;
    responseHtml: string;
    responseTruncated: boolean;
  };
  parsedExtra?: {
    template: string;
    mainHash: string | null;
    simhash: string | null;
    structured: ReturnType<typeof extractStructured>;
    images: ReturnType<typeof imageList>["images"];
    commerce: ReturnType<typeof commerceSignals>;
    linkDetails: {
      to: string;
      anchor: string;
      zone: string;
      nofollow: boolean;
    }[];
    extracted: Record<string, string[]>;
  };
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
  nofollow?: boolean;
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
  /** CMS / framework detectado en el HTML */
  cms?: Cms | null;
  /** con render JS: links que solo aparecen al ejecutar JavaScript */
  jsLinks?: number;
  /** con render JS: palabras del HTML inicial */
  rawWordCount?: number | null;
  /** datos estructurados que no coinciden con lo visible */
  schemaIssues?: string[];
  /** con render JS: diferencias entre el HTML recibido y el DOM renderizado */
  renderDiff?: RenderDiff[];
  /** motivo de la falla de red (timeout, DNS, bucle de redirecciones…) */
  fetchError?: string | null;
  /** responde 200 pero manda al usuario a otra URL desde el HTML (meta refresh o redirect de Next.js en streaming) */
  clientRedirect?: string | null;
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

export type FetchOpts = { userAgent?: string;
  templates?: TemplateRule[];
  extract?: ExtractRule[];
  /** credenciales de staging: solo se envían al host indicado (nunca a terceros ni tras un redirect a otro host) */
  auth?: { host: string; headers: Record<string, string> };
};

/** Cabeceras de autenticación para esta URL, si corresponde a su host. */
const authFor = (url: string, o: FetchOpts) => (o.auth && hostOf(url) === o.auth.host ? o.auth.headers : {});

/** Credenciales de una auditoría privada: usuario/clave (Basic), cookie o cabeceras extra. */
export type CrawlAuth = { user?: string; pass?: string; cookie?: string; headers?: Record<string, string> };
export function authHeaders(a: CrawlAuth): Record<string, string> {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(a.headers ?? {})) if (/^[a-z0-9-]{1,60}$/i.test(k) && !/[\r\n]/.test(v)) h[k] = String(v).slice(0, 2000);
  if (a.user || a.pass) h.Authorization = `Basic ${Buffer.from(`${a.user ?? ""}:${a.pass ?? ""}`).toString("base64")}`;
  if (a.cookie && !/[\r\n]/.test(a.cookie)) h.Cookie = a.cookie.slice(0, 4000);
  return h;
}

/** ¿La URL calza con algún patrón de ruta? ("/productos/*", "/blog/", "*" = todo) */
export function pathMatches(url: string, patterns: string[]): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  return patterns.some((p) => {
    const pat = p.trim();
    if (!pat) return false;
    if (pat === "*") return true;
    const re = new RegExp(`^${pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}${pat.endsWith("*") || pat.endsWith("/") ? "" : "(/.*)?$"}`, "i");
    return re.test(path);
  });
}

export type RenderDiff = { field: "title" | "meta_robots" | "canonical" | "h1" | "meta_description" | "links" | "text"; html: string; rendered: string };
type Parsed = { title: string | null; metaDesc: string | null; h1: string[]; canonical: string | null; noindex: boolean; nofollow: boolean; links: string[]; wordCount: number };
/**
 * Diferencias entre el HTML que entrega el servidor y el DOM después de ejecutar JavaScript. Google indexa con
 * render, pero las directivas (robots, canonical) del HTML inicial pueden aplicarse antes y el render puede tardar.
 */
export function renderDiff(raw: Parsed, rendered: Parsed): RenderDiff[] {
  const out: RenderDiff[] = [];
  const v = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const robots = (p: Parsed) => [p.noindex ? "noindex" : "index", p.nofollow ? "nofollow" : "follow"].join(", ");
  if (v(raw.title) !== v(rendered.title)) out.push({ field: "title", html: v(raw.title) || "(vacío)", rendered: v(rendered.title) || "(vacío)" });
  if (robots(raw) !== robots(rendered)) out.push({ field: "meta_robots", html: robots(raw), rendered: robots(rendered) });
  if ((raw.canonical ?? "") !== (rendered.canonical ?? "")) out.push({ field: "canonical", html: raw.canonical ?? "(sin canonical)", rendered: rendered.canonical ?? "(sin canonical)" });
  if (v(raw.metaDesc) !== v(rendered.metaDesc)) out.push({ field: "meta_description", html: v(raw.metaDesc) || "(vacía)", rendered: v(rendered.metaDesc) || "(vacía)" });
  if (raw.h1.map(v).join(" | ") !== rendered.h1.map(v).join(" | ")) out.push({ field: "h1", html: raw.h1.map(v).join(" | ") || "(sin H1)", rendered: rendered.h1.map(v).join(" | ") || "(sin H1)" });
  const rawLinks = new Set(raw.links);
  const onlyJs = rendered.links.filter((l) => !rawLinks.has(l));
  if (onlyJs.length) out.push({ field: "links", html: `${raw.links.length} links`, rendered: `${rendered.links.length} links; ${onlyJs.length} solo con JavaScript (ej. ${onlyJs.slice(0, 3).join(" ")})` });
  if (rendered.wordCount >= 100 && raw.wordCount < rendered.wordCount * 0.5) out.push({ field: "text", html: `${raw.wordCount} palabras`, rendered: `${rendered.wordCount} palabras` });
  return out;
}

/** Error que no vale la pena reintentar (el sitio no responde, cancelado…): el worker no reintenta. */
export class NoRetryError extends Error {
  noRetry = true;
}

export type CrawlOutcome = { status: "completed" | "partial" | "failed"; reason: string | null;
};
type OutcomePage = { url: string; finalUrl: string; status: number; error?: PageError | null; contentType: string | null; robotsBlocked?: boolean;
};

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

/** Segundos de Retry-After (número o fecha), con tope. */
export function retryAfterMs(h: string | null, capMs = 10_000): number {
  if (!h) return 2000;
  const n = Number(h);
  const ms = Number.isFinite(n) ? n * 1000 : Math.max(0, new Date(h).getTime() - Date.now());
  return Math.min(capMs, Math.max(500, Number.isFinite(ms) ? ms : 2000));
}

async function fetchFollow(url: string, o: FetchOpts = {}) {
  const t0 = Date.now();
  const doFetch = () =>
    safeFetch(url, {
      headers: {
        "User-Agent": o.userAgent || env.userAgent,
        Accept: "text/html,*/*",
        ...authFor(url, o),
      },
      timeoutMs: 25000,
    });
  let r = await doFetch();
  // 429/503 = el servidor pide bajar el ritmo (Shopify, Cloudflare): esperar y reintentar, no es un link roto
  for (
    let i = 0;
    i < 2 &&
    (r.res.status === 429 ||
      (r.res.status === 503 && r.res.headers.get("retry-after")));
    i++
  ) {
    await r.res.body?.cancel().catch(() => {});
    await new Promise((ok) =>
      setTimeout(
        ok,
        retryAfterMs(r.res.headers.get("retry-after")) *
          (1 + Math.random() * 0.3),
      ),
    );
    r = await doFetch();
  }
  const { res, finalUrl, redirects } = r;
  const ct = res.headers.get("content-type");
  const isText =
    ct?.includes("html") ||
    res.status === 403 ||
    res.status === 503 ||
    res.status === 429;
  let html = "",
    responseTruncated = false;
  if (isText && res.body) {
    const reader = res.body.getReader(),
      chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const left = 2 * 1024 * 1024 - bytes;
        chunks.push(value.subarray(0, left));
        bytes += Math.min(value.length, left);
        if (value.length > left) {
          responseTruncated = true;
          await reader.cancel();
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
    html = Buffer.concat(chunks).toString("utf8");
  } else await res.body?.cancel().catch(() => {});
  const headers = Object.fromEntries(
    [...res.headers.entries()].filter(
      ([k]) => !/[Cc]ookie|authorization|authentication/i.test(k),
    ),
  );
  const waf = detectWaf(res.status, res.headers, html);
  return {
    status: res.status,
    finalUrl,
    redirects,
    contentType: ct,
    html: waf ? "" : html,
    responseHtml: html,
    responseTruncated,
    headers,
    waf,
    ms: Date.now() - t0,
    xRobots: res.headers.get("x-robots-tag"),
  };
}

/** Máximo de HTML guardado como evidencia por URL. */
const EVIDENCE_MAX = 256 * 1024;

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
            headers: { ...req.headers(), "user-agent": o.userAgent || env.userAgent, ...authFor(req.url(), o) },
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

/** Directivas de robots: "noindex" o "none" (= noindex, nofollow). */
const robotsNoindex = (directives: string) => /(^|[\s,])(noindex|none)([\s,]|$)/i.test(directives);
/** "nofollow" o "none" (= noindex, nofollow). */
const robotsNofollow = (directives: string) => /(^|[\s,])(nofollow|none)([\s,]|$)/i.test(directives);

/**
 * X-Robots-Tag: "noindex", "googlebot: noindex" o "bingbot: noindex, otherbot: none". Solo cuenta lo que aplica a
 * Googlebot (sin bot o "googlebot:"); un "bingbot: noindex" no saca la página de Google.
 */
export function xRobotsNoindex(header: string | null | undefined, test: (d: string) => boolean = robotsNoindex): boolean {
  if (!header) return false;
  let agent: string | null = null;
  for (const raw of header.split(",")) {
    const part = raw.trim();
    const m = part.match(/^([a-z0-9_-]+)\s*:\s*(.*)$/i);
    let directive = part;
    if (m && !/^(unavailable_after|max-snippet|max-image-preview|max-video-preview)$/i.test(m[1])) {
      agent = m[1].toLowerCase();
      directive = m[2];
    }
    if ((agent === null || agent === "googlebot") && test(directive)) return true;
  }
  return false;
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

type DomNode = { type: string; data?: string; parent?: DomNode | null; next?: DomNode | null; children?: DomNode[] };

/**
 * Streaming SSR de React (Next.js app router con Suspense): el servidor manda primero el layout con marcadores
 * (<template id="B:0"> / <template id="P:1">) y al final del body el contenido real en <div hidden id="S:0">, que
 * unos scripts ($RC/$RS) mueven a su lugar al cargar. Google ejecuta esos scripts; nosotros los replicamos sobre el
 * HTML para medir el contenido donde de verdad aparece (si no, el <main> queda vacío: "0 palabras").
 */
export function resolveReactStreaming($: cheerio.CheerioAPI): number {
  const calls: [string, string, string][] = [];
  $("script").each((_, el) => {
    for (const m of $(el).text().matchAll(/\$R([CS])\("([^"]+)","([^"]+)"/g)) calls.push([m[1], m[2], m[3]]);
  });
  // sin scripts reconocibles: emparejar por número (B:3/P:3 ↔ S:3), que es lo que hace React hoy
  if (!calls.length)
    $('div[hidden][id^="S:"]').each((_, el) => {
      const n = ($(el).attr("id") ?? "").slice(2);
      if ($(`template[id="B:${n}"]`).length) calls.push(["C", `B:${n}`, `S:${n}`]);
      else if ($(`template[id="P:${n}"]`).length) calls.push(["S", `S:${n}`, `P:${n}`]);
    });
  const byId = (id: string) => $("[id]").filter((_, e) => $(e).attr("id") === id).first();
  let done = 0;
  for (const [kind, a, b] of calls) {
    const segment = byId(kind === "C" ? b : a);
    const marker = byId(kind === "C" ? a : b);
    if (!segment.length || !marker.length) continue;
    const content = segment.contents();
    if (kind === "S") {
      marker.replaceWith(content);
    } else {
      // $RC: quita el fallback (lo que hay entre el template y el comentario de cierre "/$") y pone el contenido
      let node = (marker.get(0) as unknown as DomNode).next ?? null;
      let depth = 0;
      while (node) {
        const nxt: DomNode | null = node.next ?? null;
        if (node.type === "comment") {
          const d = node.data ?? "";
          if (d === "/$") {
            if (depth === 0) break;
            depth--;
          } else if (d === "$" || d === "$?" || d === "$!") depth++;
        }
        $(node as never).remove();
        node = nxt;
      }
      // se inserta junto al template (un elemento): cheerio no inserta al lado de un comentario
      marker.replaceWith(content);
    }
    segment.remove();
    done++;
  }
  return done;
}

/** Cloudflare Email Obfuscation: el correo va cifrado con XOR (primer byte = clave) en data-cfemail o en el #hash del link. */
export function decodeCfEmail(hex: string): string | null {
  if (!/^[0-9a-f]{4,}$/i.test(hex) || hex.length % 2) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return /^[^\s@]+@[^\s@]+$/.test(out) ? out : null;
}

/**
 * Cloudflare reescribe los correos del HTML a /cdn-cgi/l/email-protection#… y los descifra en el navegador: no son
 * links internos ni páginas del sitio. Se vuelven mailto: y el texto "[email protected]" recupera el correo.
 */
function resolveCloudflareEmails($: cheerio.CheerioAPI) {
  $("[data-cfemail]").each((_, el) => {
    const email = decodeCfEmail($(el).attr("data-cfemail") ?? "");
    if (email) $(el).replaceWith(email);
  });
  $('a[href*="/cdn-cgi/l/email-protection"]').each((_, el) => {
    const hash = ($(el).attr("href") ?? "").split("#")[1] ?? "";
    const email = decodeCfEmail(hash);
    $(el).attr("href", email ? `mailto:${email}` : "#");
  });
}

/** Rutas internas de Cloudflare (/cdn-cgi/…): las inyecta el CDN, no son parte del sitio. */
export const isCdnInternal = (u: string) => {
  try {
    return new URL(u).pathname.startsWith("/cdn-cgi/");
  } catch {
    return false;
  }
};

/**
 * Redirección desde el HTML: la respuesta es 200 pero el navegador termina en otra URL. Casos: <meta http-equiv="refresh"
 * content="0;url=…"> y el redirect() de Next.js dentro de Suspense, que ya mandó el 200 y redirige con
 * $RX("B:n","NEXT_REDIRECT;replace;/destino;307;"). Medir el contenido de esas páginas da falsos «sin H1» y «0 palabras».
 */
export function clientRedirectOf($: cheerio.CheerioAPI, url: string): string | null {
  const refresh = $('meta[http-equiv="refresh" i]').attr("content") ?? "";
  const m = refresh.match(/^\s*(\d+(?:\.\d+)?)?\s*[;,]\s*url\s*=\s*['"]?([^'"\s]+)/i);
  // un refresh con demora larga es una recarga programada, no una redirección
  if (m && Number(m[1] ?? 0) <= 10) {
    const to = normUrl(m[2], url);
    if (to && to !== url) return to;
  }
  let next: string | null = null;
  $("script").each((_, el) => {
    const r = $(el).text().match(/NEXT_REDIRECT;[a-z]*;([^;"]+);\d*;?/);
    if (r && !next) next = normUrl(r[1], url);
  });
  return next && next !== url ? next : null;
}

export function parseHtml(html: string, url: string, options: FetchOpts = {}) {
  const $ = cheerio.load(html);
  resolveReactStreaming($);
  resolveCloudflareEmails($);
  const clientRedirect = clientRedirectOf($, url);
  const canonicalRaw = $('link[rel="canonical"]').attr("href");
  const canonical = canonicalRaw ? normUrl(canonicalRaw, url) : null;
  const robotsMeta = $('meta[name="robots" i], meta[name="googlebot" i]')
    .map((_, el) => $(el).attr("content") ?? "")
    .get()
    .join(" ");
  const jsonldTypes: string[] = [];
  const jsonldNodes: any[] = [];
  let jsonldErrors = 0;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      // plugins de WordPress envuelven el JSON-LD en CDATA o comentarios HTML: no es un error
      const data = JSON.parse(
        $(el)
          .text()
          .trim()
          .replace(/^(<!--|\/\/\s*<!\[CDATA\[|<!\[CDATA\[)/, "")
          .replace(/(-->|\/\/\s*\]\]>|\]\]>)$/, "")
          .trim(),
      );
      const walk = (n: any) => {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) return n.forEach(walk);
        if (n["@type"]) {
          jsonldTypes.push(...[].concat(n["@type"]));
          jsonldNodes.push(n);
        }
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
    if (u && !rel.includes("nofollow") && !isCdnInternal(u)) links.add(u);
  });
  // el destino de la redirección se rastrea como cualquier link
  if (clientRedirect) links.add(clientRedirect);
  const headings: { tag: string; text: string }[] = [];
  $("h1,h2,h3").each((_, el) => {
    // los títulos del menú y del pie («Ayuda», «Contacto», el nombre de la marca) no son secciones del contenido;
    // un <header> dentro de <article>/<main> sí es parte de la página
    const $el = $(el);
    if ($el.closest("footer, nav, aside, [role=contentinfo], [role=navigation]").length) return;
    const head = $el.closest("header");
    if (head.length && !head.closest("main, article").length) return;
    const t = $el.text().replace(/\s+/g, " ").trim();
    if (t) headings.push({ tag: el.tagName.toLowerCase(), text: t });
  });
  // sin atributo alt (alt="" es correcto en imágenes decorativas); fuera píxeles de seguimiento y ocultas
  const imgNoAlt = $("img").filter((_, el) => {
    const $i = $(el);
    if ($i.attr("alt") !== undefined) return false;
    if (
      ["0", "1"].includes($i.attr("width") ?? "") ||
      ["0", "1"].includes($i.attr("height") ?? "")
    )
      return false;
    if (
      /display\s*:\s*none|visibility\s*:\s*hidden/i.test($i.attr("style") ?? "")
    )
      return false;
    if (
      $i.attr("aria-hidden") === "true" ||
      $i.attr("role") === "presentation" ||
      $i.attr("role") === "none"
    )
      return false;
    return true;
  }).length;
  const structured = extractStructured($, jsonldNodes);
  const commerce = commerceSignals($, url, structured);
  const media = imageList($, url);
  const extracted = extractCustom(html, $, options.extract ?? []);
  const linkDetails = $("a[href]")
    .slice(0, 2000)
    .map((_, el) => {
      const a = $(el),
        to = normUrl(a.attr("href")!, url);
      // la miga de pan suele ir dentro de <nav aria-label="breadcrumb">: se revisa antes que nav
      const zone = a.closest('[aria-label*="breadcrumb" i],[aria-label*="miga" i],.breadcrumb,.breadcrumbs,[itemtype*="BreadcrumbList"]').length
        ? "breadcrumb"
        : ["nav", "header", "footer", "aside"].find((z) => a.closest(z).length) || "content";
      return to
        ? {
            to,
            anchor: a.text().replace(/\s+/g, " ").trim().slice(0, 200),
            zone,
            nofollow: /\bnofollow\b/i.test(a.attr("rel") ?? ""),
          }
        : null;
    })
    .get();
  // fuera: código y los textos de respaldo de medios ("tu navegador no soporta video…")
  $(
    "script,style,noscript,svg,template,video,audio,iframe,object,embed,canvas,picture source",
  ).remove();
  const signals = pageSignals($, url);
  const blocks = textBlocks($);
  const body = $("main").length ? $("main") : $("body");
  const text = body.text().replace(/\s+/g, " ").trim();
  return {
    // el <title> de la página, no el de un <svg> del body
    robotsMeta,
    clientRedirect,
    parsedExtra: {
      template: classifyTemplate(
        {
          url,
          signals,
          jsonldTypes,
          h1: $("h1")
            .map((_, el) => $(el).text())
            .get(),
          title: $("title").first().text(),
        },
        options.templates,
      ),
      mainHash: mainHash(mainText(blocks)),
      simhash: simhash(mainText(blocks)),
      structured,
      images: media.images,
      commerce,
      linkDetails,
      extracted,
    },
    title:
      $("title")
        .filter((_, el) => !$(el).closest("svg").length)
        .first()
        .text()
        .trim() || null,
    metaDesc: $('meta[name="description" i]').attr("content")?.trim() || null,
    h1: $("h1")
      .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
      .get(),
    canonical,
    canonicalType: (!canonical
      ? "none"
      : canonical === url
        ? "self"
        : "other") as PageData["canonicalType"],
    noindex: robotsNoindex(robotsMeta),
    nofollow: robotsNofollow(robotsMeta),
    hreflang: $('link[rel="alternate"][hreflang]')
      .map((_, el) => ({
        lang: $(el).attr("hreflang")!,
        href: $(el).attr("href")!,
      }))
      .get(),
    jsonldTypes: [...new Set(jsonldTypes)],
    jsonldErrors,
    wordCount: text ? text.split(" ").length : 0,
    imgNoAlt,
    links: [...links],
    text,
    headings,
    blocks,
    signals,
    hash: text
      ? createHash("sha1").update(text.toLowerCase()).digest("hex")
      : null,
    // el precio puede estar fuera de <main> (barra de compra): se compara con todo el body
    schemaIssues: checkStructuredData(
      [...structured.jsonld, ...structured.microdata, ...structured.rdfa].map(e => ({ "@type": e.type, ...e.props })),
      $("body").text().replace(/\s+/g, " "),
    ),
  };
}

export async function fetchPage(
  url: string,
  render = false,
  o: FetchOpts = {},
): Promise<PageData> {
  const r = await fetchFollow(url, o);
  let html = r.html;
  let raw: ReturnType<typeof parseHtml> | null = null;
  if (render && r.status === 200 && html) {
    const rendered = await renderHtml(r.finalUrl, o);
    // se guarda el HTML inicial para saber qué depende de JavaScript (Google renderiza, pero con demora y no siempre)
    if (rendered) {
      raw = parseHtml(html, r.finalUrl, o);
      html = rendered;
    }
  }
  const parsed = html ? parseHtml(html, r.finalUrl, o) : null;
  const rawLinks = raw ? new Set(raw.links) : null;
  const rawDirectives = (p: ReturnType<typeof parseHtml>) => ({ ...p, noindex: p.noindex || xRobotsNoindex(r.xRobots), nofollow: p.nofollow || xRobotsNoindex(r.xRobots, robotsNofollow) });
  return {
    url,
    renderDiff: raw && parsed ? renderDiff(rawDirectives(raw), rawDirectives(parsed)) : [],
    evidence: {
      robotsMeta: parsed?.robotsMeta ?? "",
      xRobots: r.xRobots,
      headers: r.headers,
      htmlSnippet: r.responseHtml.slice(0, 8000),
      // evidencia: hasta 256 KB por URL (se parsea hasta 2 MB); el HTML completo de miles de páginas no cabe en memoria
      responseHtml: r.responseHtml.slice(0, EVIDENCE_MAX),
      responseTruncated: r.responseTruncated || r.responseHtml.length > EVIDENCE_MAX,
    },
    parsedExtra: parsed?.parsedExtra,
    finalUrl: r.finalUrl,
    status: r.status,
    redirects: r.redirects,
    contentType: r.contentType,
    title: parsed?.title ?? null,
    metaDesc: parsed?.metaDesc ?? null,
    h1: parsed?.h1 ?? [],
    canonical: parsed?.canonical ?? null,
    canonicalType: parsed?.canonicalType ?? "none",
    noindex: (parsed?.noindex ?? false) || xRobotsNoindex(r.xRobots),
    nofollow:
      (parsed?.nofollow ?? false) || xRobotsNoindex(r.xRobots, robotsNofollow),
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
    signals: parsed?.signals ?? {
      linkGroup: 0,
      article: false,
      time: false,
      cart: false,
      price: false,
    },
    error: r.waf ? "blocked_by_waf" : undefined,
    cms: html ? detectCms(html) : null,
    jsLinks:
      rawLinks && parsed
        ? parsed.links.filter((l) => !rawLinks.has(l)).length
        : 0,
    rawWordCount: raw ? raw.wordCount : null,
    schemaIssues: parsed?.schemaIssues ?? [],
    clientRedirect: r.status === 200 ? parsed?.clientRedirect ?? null : null,
  };
}

type RowCtx = { inlinks: number; depth: number; inSitemap: boolean; lastmod: string | Date | null; orphan: boolean; blocked: boolean; isInternal: (u: string) => boolean };
/** Fila de Page para guardar una página leída (al terminar o al pausar el crawl). */
function pageRow(crawlId: string, p: PageData, x: RowCtx) {
  return {
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
    nofollow: p.nofollow ?? false,
    hreflang: p.hreflang,
    jsonldTypes: p.jsonldTypes,
    jsonldErrors: p.jsonldErrors,
    wordCount: p.wordCount,
    imgNoAlt: p.imgNoAlt,
    inlinks: x.inlinks,
    outlinks: p.links.length,
    links: p.links.filter(x.isInternal).slice(0, 500),
    responseMs: p.responseMs,
    depth: x.depth,
    contentHash: p.contentHash,
    inSitemap: x.inSitemap,
    lastmod: x.lastmod ? new Date(x.lastmod) : null,
    orphan: x.orphan,
    blocked: x.blocked,
    error: p.error ?? null,
    jsLinks: p.jsLinks ?? 0,
    rawWordCount: p.rawWordCount ?? null,
    schemaIssues: p.schemaIssues ?? [],
    robotsMeta: p.evidence?.robotsMeta ?? null,
    xRobots: p.evidence?.xRobots ?? null,
    headers: p.evidence?.headers ?? {},
    htmlSnippet: p.evidence?.htmlSnippet ?? null,
    responseHtml: p.evidence?.responseHtml ?? null,
    responseTruncated: p.evidence?.responseTruncated ?? false,
    template: p.parsedExtra?.template ?? null,
    mainHash: p.parsedExtra?.mainHash ?? null,
    simhash: p.parsedExtra?.simhash ?? null,
    structured: JSON.parse(JSON.stringify(p.parsedExtra?.structured ?? {})),
    images: p.parsedExtra?.images ?? [],
    commerce: JSON.parse(JSON.stringify(p.parsedExtra?.commerce ?? {})),
    // solo enlaces internos y con tope, como `links`: es lo que usan arquitectura y evidencia
    linkDetails: (p.parsedExtra?.linkDetails ?? []).filter((l) => x.isInternal(l.to)).slice(0, 500),
    extracted: p.parsedExtra?.extracted ?? {},
    fetchError: p.fetchError ?? null,
    clientRedirect: p.clientRedirect ?? null,
    renderDiff: JSON.parse(JSON.stringify(p.renderDiff ?? [])),
  };
}

/** PageData desde una fila guardada: para reanudar un crawl en pausa sin volver a pedir esas URLs. */
export function pageFromRow(r: import("@prisma/client").Page): PageData {
  const j = (v: unknown): any => (v && typeof v === "object" ? v : {});
  return {
    url: r.url,
    finalUrl: r.finalUrl ?? r.url,
    status: r.status,
    redirects: (r.redirects as { url: string; status: number }[]) ?? [],
    contentType: r.contentType,
    title: r.title,
    metaDesc: r.metaDesc,
    h1: r.h1,
    canonical: r.canonical,
    canonicalType: (r.canonicalType ?? "none") as PageData["canonicalType"],
    noindex: r.noindex,
    nofollow: r.nofollow,
    hreflang: (r.hreflang as { lang: string; href: string }[]) ?? [],
    jsonldTypes: r.jsonldTypes,
    jsonldErrors: r.jsonldErrors,
    wordCount: r.wordCount,
    imgNoAlt: r.imgNoAlt,
    links: r.links,
    responseMs: r.responseMs,
    contentHash: r.contentHash,
    text: "",
    headings: [],
    blocks: [],
    signals: { linkGroup: 0, article: false, time: false, cart: false, price: false },
    error: (r.error as PageError | null) ?? undefined,
    jsLinks: r.jsLinks,
    rawWordCount: r.rawWordCount,
    schemaIssues: r.schemaIssues,
    renderDiff: (r.renderDiff as RenderDiff[]) ?? [],
    fetchError: r.fetchError,
    clientRedirect: r.clientRedirect,
    evidence: {
      robotsMeta: r.robotsMeta ?? "",
      xRobots: r.xRobots,
      headers: j(r.headers),
      htmlSnippet: r.htmlSnippet ?? "",
      responseHtml: r.responseHtml ?? "",
      responseTruncated: r.responseTruncated,
    },
    parsedExtra: {
      template: r.template ?? "other",
      mainHash: r.mainHash,
      simhash: r.simhash,
      structured: { jsonld: [], microdata: [], rdfa: [], ...j(r.structured) },
      images: Array.isArray(r.images) ? (r.images as any) : [],
      commerce: j(r.commerce),
      linkDetails: Array.isArray(r.linkDetails) ? (r.linkDetails as any) : [],
      extracted: j(r.extracted),
    },
  };
}

/** Guarda lo leído y la cola pendiente; el crawl queda «paused» hasta que se reanude. */
async function pauseCrawl(crawlId: string, pages: PageData[], frontier: { queue: string[]; next: string[]; seen: [string, number][]; depth: number }, jobRunId?: string) {
  const depthOf = new Map(frontier.seen);
  const rows = pages.map((p) =>
    pageRow(crawlId, p, { inlinks: 0, depth: depthOf.get(p.url) ?? -1, inSitemap: false, lastmod: null, orphan: false, blocked: false, isInternal: () => true }),
  );
  await db.page.deleteMany({ where: { crawlId } });
  for (let i = 0; i < rows.length; i += 200) await db.page.createMany({ data: rows.slice(i, i + 200), skipDuplicates: true });
  await db.crawl.update({ where: { id: crawlId }, data: { status: "paused", frontier, reason: `En pausa: ${pages.length} URLs leídas, ${frontier.queue.length + frontier.next.length} en cola` } });
  await jobProgress(jobRunId, 100, "en pausa");
}

/** Crawl BFS con concurrencia limitada. */
export async function runCrawl(crawlId: string, jobRunId?: string) {
  const crawl = await db.crawl.findUniqueOrThrow({
    where: { id: crawlId },
    include: { project: true },
  });
  const projectCrawler =
    ((crawl.project.settings ?? {}) as Record<string, any>).crawler ?? {};
  const o: CrawlOptions = {
    maxPages: 500,
    concurrency: 5,
    render: false,
    maxDepth: 20,
    maxPerPattern: 50,
    ignoreParams: DEFAULT_IGNORE_PARAMS,
    ...projectCrawler,
    ...(crawl.options as CrawlOptions),
  };
  const num = (v: unknown, d: number) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
  // 0 es un valor válido (maxDepth 0 = solo la URL de inicio): no usar «|| defecto»
  o.concurrency = Math.max(1, Math.min(10, num(o.concurrency, 5)));
  o.maxDepth = Math.max(0, Math.min(50, num(o.maxDepth, 20)));
  o.maxPages = await crawlLimit(crawl.projectId, o.maxPages ?? 500);
  const ua = o.userAgent || env.userAgent;
  // credenciales de staging: solo en crawls privados, descifradas en memoria y nunca copiadas a config
  let authHdrs: Record<string, string> = {};
  if (crawl.private && o.auth) {
    const { decryptToken } = await import("../gsc-oauth");
    authHdrs = authHeaders(JSON.parse(decryptToken(o.auth).plain) as CrawlAuth);
  }
  const renderFor = (u: string) => Boolean(o.render) && (!o.renderPaths?.length || pathMatches(u, o.renderPaths));
  const patterns = new PatternLimiter(o.maxPerPattern ?? 0);
  const clean = (u: string) => normUrl(stripParams(u, o.ignoreParams ?? []))!;
  let wafStreak = 0;
  let wafAbort = false;
  const domain = crawl.project.domain
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const start = normUrl(o.startUrl || `https://${domain}/`)!;
  const site = hostOf(start);
  const origin = new URL(start).origin;
  if (crawl.status === "cancelled") throw new NoRetryError("Crawl cancelado antes de empezar");
  await db.crawl.update({ where: { id: crawlId }, data: { status: "running", reason: null,
      config: JSON.parse(JSON.stringify({ ...o, auth: o.auth ? "(credenciales guardadas)" : undefined })),
      rulesVersion: RULES_VERSION,
    },
  });

  // robots + sitemap
  await jobProgress(jobRunId, 1, "robots.txt");
  let robots: Robots = { disallow: [], allow: [], sitemaps: [], group: "" };
  let robotsTxt: string | null = null;
  let robotsFailure: string | null = null;
  try {
    const { res: r } = await safeFetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": ua, ...authHdrs },
    });
    if (r.status === 429 || r.status >= 500)
      robotsFailure = `robots.txt respondió HTTP ${r.status}; se suspende el crawl para respetar el control de acceso`;
    if (r.ok) {
      robotsTxt = await r.text();
      // «bloqueada» en la auditoría = bloqueada para Googlebot. Si robots.txt tiene un grupo propio para nuestro
      // bot, se respeta ese (no se piden URLs que el sitio nos pidió no rastrear)
      const botToken = (ua.match(/([a-z0-9_-]*bot)\b/i)?.[1] ?? "").toLowerCase();
      const ownGroup = botToken && botToken !== "googlebot" && new RegExp(`^\\s*user-agent\\s*:\\s*${botToken.replace(/[^a-z0-9_-]/g, "")}\\s*$`, "im").test(robotsTxt);
      robots = parseRobots(robotsTxt, ownGroup ? botToken : "googlebot");
    }
  } catch {}
  if (robotsFailure) {
    await db.crawl.update({
      where: { id: crawlId },
      data: { status: "failed", reason: robotsFailure, finishedAt: new Date() },
    });
    throw new NoRetryError(robotsFailure);
  }
  await jobProgress(jobRunId, 3, "sitemap.xml");
  const sitemapList = robots.sitemaps.length
    ? robots.sitemaps
    : [`${origin}/sitemap.xml`];
  const sitemapAudit = await fetchSitemapEvidence(sitemapList, 20000, {
    userAgent: ua,
  });
  const sitemapUrls = new Set(
    sitemapAudit.entries
      .map((e) => normUrl(e.url))
      .filter((u): u is string => Boolean(u) && hostOf(u!) === site),
  );
  const sitemapLastmod = new Map(
    sitemapAudit.entries.map((e) => [normUrl(e.url), e.lastmod]),
  );
  await db.crawl.update({
    where: { id: crawlId },
    data: { robots: robotsTxt, sitemapUrls: sitemapUrls.size, sitemapAudit },
  });

  const isInternal = (u: string) => hostOf(u) === site;
  // bloqueada para Googlebot según robots.txt (comodines, grupos y precedencia como Google)
  const blocked = (u: string) => !robotsAllows(robots, u);
  const skipExt =
    /\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3|css|js|ico|woff2?|xml|json)(\?|$)/i;

  let startError: string | null = null;
  // cancelación: el usuario puede cancelar el trabajo; se revisa entre tandas
  let lastCheck = 0;
  let pauseRequested = false;
  const cancelled = async () => {
    if (Date.now() - lastCheck < 3000) return false;
    lastCheck = Date.now();
    const c = await db.crawl.findUnique({
      where: { id: crawlId },
      select: { status: true },
    });
    if (c?.status === "pausing") pauseRequested = true;
    return c?.status === "cancelled";
  };
  const fetchOpts: FetchOpts = { userAgent: ua, templates: o.templates, extract: o.extract, auth: { host: site, headers: authHdrs } };
  const seen = new Map<string, number>(); // url → depth
  const pages: PageData[] = [];
  const external = new Set<string>();
  let queue = [start];
  seen.set(start, 0);
  const limit = pLimit(o.concurrency!);
  let depth = 0;
  // reanudación: las páginas ya leídas están guardadas; se retoma la cola donde quedó
  const frontier = crawl.frontier as { queue: string[]; next?: string[]; seen: [string, number][]; depth: number } | null;
  // links ya descubiertos del nivel siguiente cuando la pausa cayó a mitad de un nivel
  let carry: string[] = [];
  if (frontier) {
    const done = await db.page.findMany({ where: { crawlId } });
    pages.push(...done.map(pageFromRow));
    seen.clear();
    for (const [u, d] of frontier.seen) seen.set(u, d);
    queue = frontier.queue;
    carry = frontier.next ?? [];
    depth = frontier.depth;
    if (!queue.length) {
      queue = carry;
      carry = [];
    }
  }
  while (
    queue.length &&
    pages.length < o.maxPages! &&
    depth <= o.maxDepth! &&
    !wafAbort
  ) {
    const batch = queue.slice(0, o.maxPages! - pages.length);
    const next: string[] = carry;
    carry = [];
    const pending = new Set(batch);
    await Promise.all(
      batch.map((u) =>
        limit(async () => {
          // pausa pedida: lo que falta de la tanda vuelve a la cola
          if (pauseRequested) return;
          pending.delete(u);
          await cancelled();
          if (blocked(u)) {
            pages.push({ ...emptyPage(u), status: 0 } as PageData);
            return;
          }
          let pd: PageData;
          try {
            pd = await fetchPage(u, renderFor(u), fetchOpts);
          } catch (e) {
            pd = {
              ...emptyPage(u),
              error: e instanceof SsrfError ? "ssrf_blocked" : "fetch_failed",
              fetchError: e instanceof RedirectLoopError ? e.message : describeFetchError(e),
            };
            if (u === start) startError = describeFetchError(e);
          }
          pages.push({ ...pd, blocks: [] }); // los bloques solo los usa Contenido: no acumularlos en crawls grandes
          // Si el WAF bloquea todo, no seguir golpeando el sitio
          wafStreak = pd.error === "blocked_by_waf" ? wafStreak + 1 : 0;
          if (wafStreak >= 15) wafAbort = true;
          if (
            pd.finalUrl !== u &&
            isInternal(pd.finalUrl) &&
            !seen.has(pd.finalUrl)
          ) {
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
          if (pages.length % 10 === 0)
            await jobProgress(
              jobRunId,
              5 + (pages.length / o.maxPages!) * 80,
              `${pages.length} urls`,
            );
        }),
      ),
    );
    if (pauseRequested) {
      await pauseCrawl(crawlId, pages, pending.size ? { queue: [...pending], next, seen: [...seen], depth } : { queue: next, next: [], seen: [...seen], depth: depth + 1 }, jobRunId);
      return { status: "paused" as const, pages: pages.length };
    }
    queue = next;
    depth++;
    if (await cancelled()) throw new NoRetryError("Crawl cancelado");
  }

  // Huérfanas: en sitemap pero no alcanzadas
  await jobProgress(jobRunId, 86, "huérfanas");
  const reached = new Set(pages.flatMap((p) => [p.url, p.finalUrl]));
  const orphans = [...sitemapUrls]
    .filter((u) => !reached.has(u))
    .slice(0, 2000);
  // si el crawl ya tocó el máximo, no se baja nada más: el máximo que pidió el usuario se respeta,
  // y esas URLs no se pueden llamar huérfanas (no se recorrió todo el sitio)
  const linkLimitHit = pages.length >= o.maxPages!;
  const orphanLimit = linkLimitHit
    ? 0
    : Math.min(orphans.length, 300, Math.max(0, o.maxPages! - pages.length));
  await Promise.all(
    orphans
      .filter((u) => !blocked(u))
      .slice(0, orphanLimit)
      .map((u) =>
        limit(async () => {
          try {
            const pd = await fetchPage(u, false, fetchOpts);
            pages.push({ ...pd, blocks: [] });
            seen.set(u, -1);
          } catch {}
        }),
      ),
  );

  // Un tiempo alto puede ser solo la carga del propio crawl (varias páginas en paralelo): las lentas se vuelven a medir
  // de a una y queda el mejor tiempo, para no marcar «respuesta lenta» por una sola medición con el servidor ocupado
  await jobProgress(jobRunId, 88, "midiendo de nuevo las respuestas lentas");
  for (const p of pages.filter((x) => x.status === 200 && !x.error && x.responseMs > SLOW_MS).sort((a, b) => b.responseMs - a.responseMs).slice(0, 20)) {
    try {
      const again = await fetchFollow(p.url, fetchOpts);
      if (again.status === 200) p.responseMs = Math.min(p.responseMs, again.ms);
    } catch {}
  }

  // Inlinks
  const inlinks = new Map<string, number>();
  for (const p of pages)
    for (const l of new Set(p.links)) inlinks.set(l, (inlinks.get(l) ?? 0) + 1);

  await jobProgress(jobRunId, 90, "guardando");
  await db.page.deleteMany({ where: { crawlId } });
  const orphanSet = new Set(linkLimitHit ? [] : orphans);
  const rows = pages.map((p) =>
    pageRow(crawlId, p, {
      inlinks: inlinks.get(p.url) ?? 0,
      depth: seen.get(p.url) ?? -1,
      inSitemap: sitemapUrls.has(p.url),
      lastmod: sitemapLastmod.get(p.url) ?? null,
      orphan: orphanSet.has(p.url),
      blocked: p.status === 0 && !p.error && blocked(p.url),
      isInternal,
    }),
  );
  for (let i = 0; i < rows.length; i += 200)
    await db.page.createMany({
      data: rows.slice(i, i + 200),
      skipDuplicates: true,
    });

  await jobProgress(jobRunId, 95, "issues");
  const saved = (await db.page.findMany({ where: { crawlId }, omit: { responseHtml: true } })) as import("@prisma/client").Page[];
  const issues = computeIssues(saved, {
    robotsTxt,
    sitemapCount: sitemapUrls.size,
    site,
  });
  await db.issue.deleteMany({ where: { crawlId } });
  for (let i = 0; i < issues.length; i += 500)
    await db.issue.createMany({
      data: issues.slice(i, i + 500).map((x) => ({ ...x, crawlId })),
    });

  const sev = (s: string) => issues.filter((x) => x.severity === s).length;
  const stats = {
    pages: saved.length,
    ok: saved.filter((p) => p.status === 200).length,
    redirects: saved.filter(
      (p) => (p.redirects && (p.redirects as unknown[]).length) || p.clientRedirect,
    ).length,
    // errores HTTP = 4xx + 5xx + sin respuesta; lo bloqueado por robots.txt no se pidió y no es un error
    errors: saved.filter(
      (p) => !p.blocked && !p.error && (p.status >= 400 || p.status === 0),
    ).length,
    http4xx: saved.filter((p) => !p.error && p.status >= 400 && p.status < 500)
      .length,
    http5xx: saved.filter((p) => !p.error && p.status >= 500).length,
    noResponse: saved.filter((p) => !p.blocked && !p.error && p.status === 0)
      .length,
    robotsBlocked: saved.filter((p) => p.blocked).length,
    blockedByWaf: saved.filter((p) => p.error === "blocked_by_waf").length,
    wafAborted: wafAbort,
    trapSkipped: [...patterns.skipped.values()].reduce((a, b) => a + b, 0),
    trapPatterns: [...patterns.skipped.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pattern, skipped]) => ({ pattern, skipped })),
    // una URL que redirige no es una página huérfana: su problema es la redirección
    orphans: linkLimitHit ? 0 : orphans.length - saved.filter((p) => p.orphan && p.clientRedirect).length,
    /** URLs del sitemap que no se alcanzaron porque el crawl tocó el máximo (no son huérfanas confirmadas) */
    sitemapNotReached: linkLimitHit ? orphans.length : 0,
    sitemap: sitemapUrls.size,
    external: external.size,
    critical: sev("critical"),
    warning: sev("warning"),
    info: sev("info"),
    avgMs: Math.round(
      saved.reduce((s, p) => s + p.responseMs, 0) / Math.max(1, saved.length),
    ),
    health: Math.max(
      0,
      Math.round(
        100 -
          ((sev("critical") * 5 + sev("warning")) / Math.max(1, saved.length)) *
            10,
      ),
    ) as number | null,
    /** cobertura: páginas leídas por links vs. el máximo pedido */
    limitReached: linkLimitHit,
    /** CMS más frecuente entre las páginas leídas (la home manda si lo tiene) */
    cms:
      pages.find((p) => p.url === start)?.cms ??
      mode(pages.map((p) => p.cms).filter((c): c is Cms => Boolean(c))),
  };
  const outcome = classifyCrawl({
    pages: pages.map((p) => ({
      url: p.url,
      finalUrl: p.finalUrl,
      status: p.status,
      error: p.error ?? null,
      contentType: p.contentType,
      robotsBlocked: p.status === 0 && !p.error && blocked(p.url),
    })),
    start,
    wafAbort,
    startError,
  });
  // sin datos mínimos no hay puntaje: un 70/100 de algo que no se leyó sería falso
  const note = healthBlocker(outcome.status, saved);
  if (note) Object.assign(stats, { health: null, healthNote: note });
  if (await cancelled()) throw new NoRetryError("Crawl cancelado");
  await db.crawl.update({
    where: { id: crawlId },
    data: {
      status: outcome.status,
      reason: outcome.reason,
      stats,
      finishedAt: new Date(),
      frontier: Prisma.DbNull,
    },
  });
  if (!crawl.private) await syncCrawlTasks(crawlId);
  // avisos inmediatos (home caída, noindex o errores nuevos en páginas con tráfico, cambios masivos): no deben tirar el crawl
  if (!crawl.private)
    await import("../watch")
      .then((w) => w.runWatch(crawl.projectId))
      .catch(() => {});
  if (!crawl.private && outcome.status !== "failed")
    await import("../pro")
      .then((m) => m.runAfterCrawl(crawlId, crawl.projectId))
      .catch(() => {});
  if (outcome.status === "failed")
    throw new NoRetryError(outcome.reason ?? "Crawl fallido");
  return { ...stats, status: outcome.status };
}

/** Por qué no se puede dar un puntaje confiable (o null si sí se puede). */
export function healthBlocker(status: string, pages: { status: number; error: string | null; contentType: string | null }[]): string | null {
  if (status === "failed") return "Sin puntaje: no se pudo acceder al sitio.";
  const ok = pages.filter((p) => p.status === 200 && !p.error && (p.contentType ?? "").includes("html")).length;
  if (!ok) return "Sin puntaje: ninguna página HTML respondió bien.";
  if (status === "partial" && ok < pages.length * 0.5) return `Sin puntaje: solo se pudieron leer ${ok} de ${pages.length} URLs, no alcanza para un puntaje confiable.`;
  return null;
}

const mode = <T,>(xs: T[]): T | null => {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

function emptyPage(url: string): PageData {
  return {
    url, finalUrl: url, status: 0, redirects: [], contentType: null, title: null, metaDesc: null, h1: [], canonical: null,
    canonicalType: "none", noindex: false, hreflang: [], jsonldTypes: [], jsonldErrors: 0, wordCount: 0, imgNoAlt: 0,
    links: [], responseMs: 0, contentHash: null, text: "", headings: [], blocks: [],
    signals: { linkGroup: 0, article: false, time: false, cart: false, price: false },
  };
}
