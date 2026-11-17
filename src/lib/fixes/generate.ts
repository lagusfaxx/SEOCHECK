/**
 * Correcciones listas para publicar. A partir del último crawl (y de Search Console si hay) arma, para cada
 * problema con solución concreta, el valor nuevo exacto: title, meta description, H1, canonical, Open Graph,
 * JSON-LD, alt de imágenes, hreflang, links rotos y redirecciones. Funciones puras: sin base ni red.
 *
 * Solo propone lo que se puede sostener con lo que la página muestra: el JSON-LD sale de datos visibles, los
 * textos salen del contenido de la página y nada inventa precios, reseñas ni promesas.
 */
import { load } from "cheerio";
import { serpWidthPx, TITLE_MAX_PX } from "../report-rules";
import { strip, STOP_ES } from "../text";

export const FIX_KINDS = ["title", "meta", "h1", "canonical", "og", "jsonld", "alt", "hreflang", "link", "redirect"] as const;
export type FixKind = (typeof FIX_KINDS)[number];
/** Lo que el script en vivo puede aplicar en el navegador; el resto se entrega como archivo o instrucción. */
export const LIVE_KINDS: ReadonlySet<string> = new Set(["title", "meta", "canonical", "og", "jsonld", "alt", "hreflang", "link"]);

export type FixPage = {
  url: string;
  finalUrl?: string | null;
  status: number;
  redirects?: unknown;
  title: string | null;
  metaDesc: string | null;
  h1: string[];
  canonical: string | null;
  canonicalType: string | null;
  noindex: boolean;
  template: string | null;
  jsonldTypes: string[];
  hreflang?: unknown;
  images?: unknown;
  links?: string[];
  commerce?: unknown;
  inSitemap?: boolean;
  inlinks?: number;
  responseHtml?: string | null;
};
export type FixIssue = { url: string; code: string; detail?: string | null };
export type FixQuery = { query: string; impressions: number; clicks: number; position: number };
export type FixCtx = {
  domain: string;
  brand: string;
  language: string;
  /** separador entre el título y la marca; si falta se detecta de los títulos del sitio */
  sep?: string;
  issues: FixIssue[];
  /** consultas de Search Console por URL (28 días) */
  queries?: Map<string, FixQuery[]>;
  /** impresiones de Search Console por URL (28 días) */
  impressions?: Map<string, number>;
};
export type Proposal = { url: string; kind: FixKind; target: string; before: string | null; after: string; reason: string; code: string; impact: number };

export const TITLE_MAX = 60;
export const META_MAX = 155;
const META_MIN = 70;

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const capFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SEP = /\s+[|·–—-]\s+/;

/** Corta en el límite de palabra sin dejar conectores ni signos colgando. */
export function cutAt(text: string, max: number, ellipsis = false): string {
  const t = clean(text);
  if (t.length <= max) return t;
  const room = ellipsis ? max - 1 : max;
  let out = t.slice(0, room + 1);
  out = out.slice(0, Math.max(out.lastIndexOf(" "), Math.floor(room * 0.6)));
  out = out.replace(/[\s,;:·|–—-]+$/g, "").replace(/\s+(y|e|o|u|de|del|la|el|los|las|en|con|para|por|a|un|una|que)$/i, "");
  return ellipsis ? `${out}…` : out;
}

/** El title sin la marca ni los segmentos repetidos ("Jammer negro · TAUPOC Chile" → "Jammer negro"). */
export function titleCore(title: string | null, brand: string): string {
  const parts = clean(title).split(SEP).filter(Boolean);
  const b = strip(brand);
  const kept = parts.filter((p) => !strip(p).includes(b) || strip(p).replace(b, "").trim().length > 12);
  return clean((kept.length ? kept : parts).join(" – "));
}

/**
 * Cómo firma el sitio sus títulos: el segmento final que más se repite ("… · TAUPOC Chile") y su separador.
 * Así las propuestas conservan la marca tal como el sitio ya la escribe.
 */
export function siteBrand(titles: (string | null)[], fallback: string): { brand: string; sep: string } {
  const count = new Map<string, number>();
  let n = 0;
  for (const t of titles) {
    const m = clean(t).match(/^(.*\S)(\s+[|·–—-]\s+)([^|·–—]+)$/);
    if (!clean(t)) continue;
    n++;
    if (m && m[3].trim().length <= 30) count.set(`${m[2].trim()}\n${m[3].trim()}`, (count.get(`${m[2].trim()}\n${m[3].trim()}`) ?? 0) + 1);
  }
  const top = [...count].sort((a, b) => b[1] - a[1])[0];
  if (top && n >= 3 && top[1] / n >= 0.4) {
    const [sep, brand] = top[0].split("\n");
    return { brand, sep };
  }
  return { brand: fallback, sep: "|" };
}

/** "GORRO DE NATACIÓN TAUPOC" → "Gorro de natación TAUPOC": un título en mayúsculas sostenidas se lee peor y ocupa más ancho. */
export function calmCase(text: string, brand: string): string {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length < 8 || letters.replace(/[^\p{Lu}]/gu, "").length / letters.length < 0.7) return text;
  const keep = new Set(brand.split(/\s+/).filter((w) => w === w.toUpperCase() && w.length > 1));
  return capFirst(text.split(/(\s+)/).map((w) => (keep.has(w) || /\d/.test(w) ? w : w.toLowerCase())).join(""));
}

/** Title final: núcleo + marca si cabe en el ancho que Google suele mostrar. */
export function buildTitle(core: string, brand: string, sep = "|"): string {
  return buildTitleWith(core, brand, sep);
}
function buildTitleWith(core: string, brand: string, sep: string): string {
  let c = clean(core).replace(new RegExp(`\\s*[|·–—-]\\s*${esc(brand)}.*$`, "i"), "");
  c = capFirst(calmCase(c, brand));
  const fits = (t: string) => t.length <= TITLE_MAX && serpWidthPx(t, 20) <= TITLE_MAX_PX;
  // la marca ya está en el núcleo ("Gorro TAUPOC unisex"): no se repite
  const brandIn = strip(c).includes(strip(brand));
  const full = `${c} ${sep} ${brand}`;
  if (!brandIn && fits(full)) return full;
  // no cabe con la marca: va el título completo sin ella (la marca es lo menos importante del titular)
  if (fits(c)) return c;
  for (let room = TITLE_MAX; room >= 30; room -= 4) if (fits(cutAt(c, room))) return cutAt(c, room);
  return cutAt(c, 40);
}

const slugWords = (url: string) => {
  try {
    const u = new URL(url);
    const seg = decodeURIComponent(u.pathname).split("/").filter(Boolean).pop() ?? "";
    const w = seg.replace(/\.[a-z0-9]{2,5}$/i, "").split(/[-_+\s]+/).filter((x) => x && !/^[0-9a-f]{8,}$/i.test(x));
    const q = [...u.searchParams.entries()].filter(([k]) => /^(page|p|pagina|pag)$/i.test(k)).map(([, v]) => `página ${v}`);
    return [w.join(" "), ...q].filter(Boolean).join(" – ");
  } catch {
    return "";
  }
};
const pathTokens = (url: string) => {
  try {
    return new Set(strip(decodeURIComponent(new URL(url).pathname)).split(/[^a-z0-9ñ]+/).filter((t) => t.length > 1 && !STOP_ES.has(t) && !/^(html?|php|aspx?)$/.test(t)));
  } catch {
    return new Set<string>();
  }
};

/** La página viva que más se parece a una URL rota (por las palabras de la ruta). null si ninguna se parece. */
export function bestMatch(broken: string, candidates: string[]): { url: string; score: number } | null {
  const a = pathTokens(broken);
  if (!a.size) return null;
  let best: { url: string; score: number } | null = null;
  for (const c of candidates) {
    if (c === broken) continue;
    const b = pathTokens(c);
    if (!b.size) continue;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const score = inter / (a.size + b.size - inter);
    if (score > (best?.score ?? 0)) best = { url: c, score };
  }
  if (best && best.score >= 0.5) return best;
  // sin parecido suficiente: la sección padre, si existe (nunca la home: Google lo trata como soft 404)
  try {
    const u = new URL(broken);
    const segs = u.pathname.split("/").filter(Boolean);
    while (segs.length > 1) {
      segs.pop();
      const parent = `${u.origin}/${segs.join("/")}`;
      const hit = candidates.find((c) => c.replace(/\/$/, "") === parent);
      if (hit) return { url: hit, score: 0.3 };
    }
  } catch {}
  return null;
}

const GENERIC_TITLE = /^(inicio|home|homepage|home page|p[aá]gina principal|portada|index|bienvenid[oa]s?|untitled|sin t[ií]tulo|mi sitio|my site)$/i;
/** "Somos una tienda especializada en cafeteras espresso, molinos y…" → "Tienda especializada en cafeteras espresso". */
export function homePitch(lead: string): string {
  const first = clean(lead).split(/(?<=[.!?])\s/)[0]?.replace(/[.!?]+$/, "") ?? "";
  const t = first.replace(/^(somos|en \S+ somos|bienvenid[oa]s? a \S+[,:]?)\s+(una?|el|la|los|las)?\s*/i, "").split(/,|\s+(?:y|para|que|con)\s+/)[0];
  return t.length >= 15 && t.length <= 60 ? capFirst(clean(t)) : "";
}

type Dom = ReturnType<typeof load>;
const BOILER = "nav,header,footer,aside,script,style,noscript,form,[role=navigation],[class*=cookie],[id*=cookie],[class*=breadcrumb]";

/** Primeros párrafos propios de la página (fuera de menú y pie), para armar la descripción. */
export function leadText($: Dom): string {
  const root = $("main").length ? $("main") : $("article").length ? $("article") : $("body");
  const out: string[] = [];
  root.find("p").each((_, el) => {
    const p = $(el);
    if (p.closest(BOILER).length) return;
    const t = clean(p.text());
    if (t.length >= 60 && /[a-záéíóúñ]{3,}\s+[a-záéíóúñ]{2,}/i.test(t)) out.push(t);
    if (out.join(" ").length > 400) return false;
  });
  return out.join(" ");
}

/** Descripción de hasta 155 caracteres que termina en frase completa cuando se puede. */
export function buildMeta(text: string): string {
  const t = clean(text);
  if (t.length <= META_MAX) return t;
  const sentences = t.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? [];
  let acc = "";
  for (const s of sentences) {
    if ((acc + s).trim().length > META_MAX) break;
    acc = (acc + s).trimStart();
  }
  if (acc.trim().length >= META_MIN) return acc.trim();
  return cutAt(t, META_MAX, true);
}

/** Sin texto propio en la página solo se propone descripción para fichas con precio; el resto sería relleno. */
const fallbackMeta = (p: FixPage, core: string, brand: string) =>
  p.template === "product" && commerceOf(p).price != null ? `${core} en ${brand}. Revisa características y disponibilidad, y compra en línea.` : "";

type Commerce = { price?: number | string | null; currency?: string | null; availability?: string | null; sku?: string | null; name?: string | null };
const commerceOf = (p: FixPage) => ((p.commerce ?? {}) as Commerce) || {};
type Img = { src: string; alt: string | null; width?: number | null; height?: number | null };
const imagesOf = (p: FixPage) => (Array.isArray(p.images) ? (p.images as Img[]) : []);

/** Texto alternativo desde el nombre del archivo; si el nombre no dice nada, desde el tema de la página. */
export function altFor(src: string, pageTopic: string, n: number): string {
  let name = "";
  try {
    name = decodeURIComponent(new URL(src).pathname.split("/").pop() ?? "").replace(/\.[a-z0-9]{2,5}$/i, "");
  } catch {}
  const words = name.split(/[-_+\s.]+/).filter((w) => /^[a-záéíóúñü]+$/i.test(w) && !/^(img|image|imagen|foto|photo|pic|dsc|screenshot|captura|whatsapp|copy|copia|final|scaled|min|large|small|medium|thumb|thumbnail|banner\d*)$/i.test(w) && !/\d{3,}/.test(w) && !/^[0-9a-f]{6,}$/i.test(w));
  if (words.filter((w) => w.length >= 3).length >= 2) return capFirst(words.join(" ").toLowerCase()).slice(0, 110);
  const topic = clean(pageTopic);
  if (!topic) return "";
  return (n === 0 ? topic : `${topic} – imagen ${n + 1}`).slice(0, 110);
}

const ld = (o: unknown) => JSON.stringify(o, null, 2);
const AVAIL: Record<string, string> = { instock: "https://schema.org/InStock", outofstock: "https://schema.org/OutOfStock", preorder: "https://schema.org/PreOrder" };

/** Preguntas y respuestas visibles en la página (encabezado que termina en "?" + su texto, o <details>). */
export function visibleFaq($: Dom): { q: string; a: string }[] {
  const out: { q: string; a: string }[] = [];
  const seen = new Set<string>();
  const push = (q: string, a: string) => {
    q = clean(q);
    a = clean(a);
    if (q.length < 8 || q.length > 200 || a.length < 20 || seen.has(q)) return;
    seen.add(q);
    out.push({ q, a: a.slice(0, 1200) });
  };
  $("details").each((_, el) => {
    const d = $(el);
    if (d.closest("nav,header,footer").length) return;
    const q = d.children("summary").first().text();
    if (!/\?\s*$/.test(clean(q))) return;
    const body = d.clone();
    body.children("summary").remove();
    push(q, body.text());
  });
  $("h2,h3,h4").each((_, el) => {
    const h = $(el);
    if (h.closest("nav,header,footer,details").length) return;
    const q = clean(h.text());
    if (!/^¿?.{6,}\?$/.test(q)) return;
    const parts: string[] = [];
    let sib = h.next();
    while (sib.length && !sib.is("h1,h2,h3,h4") && parts.join(" ").length < 1200) {
      if (sib.is("p,ul,ol,div")) parts.push(sib.text());
      sib = sib.next();
    }
    push(q, parts.join(" "));
  });
  return out.slice(0, 20);
}

const sevOf: Record<string, number> = {
  title_missing: 5, broken_link: 5, http_4xx: 4.5, meta_missing: 4, title_dup: 4, canonical_missing: 3.5, h1_missing: 3.5, hreflang_no_self: 3, redirect_chain: 3,
  schema_missing: 3, gsc_ctr: 3.5, meta_dup: 2.5, og_missing: 2, img_no_alt: 2, faq_schema: 2, title_short: 1.5, meta_short: 1.5, title_long: 1, meta_long: 1,
};

export function generateFixes(pages: FixPage[], ctx: FixCtx): Proposal[] {
  const out: Proposal[] = [];
  const detected = siteBrand(pages.filter((p) => p.status === 200).map((p) => p.title), ctx.brand);
  const brand = detected.brand;
  const sep = ctx.sep ?? detected.sep;
  const buildTitle = (core: string, b: string) => buildTitleWith(core, b, sep);
  const byUrl = new Map(pages.map((p) => [p.url, p]));
  const codes = new Map<string, Set<string>>();
  for (const i of ctx.issues) codes.set(i.url, (codes.get(i.url) ?? new Set()).add(i.code));
  const has = (url: string, code: string) => codes.get(url)?.has(code) ?? false;
  const moved = (p: FixPage) => Boolean(p.finalUrl && p.finalUrl !== p.url && Array.isArray(p.redirects) && (p.redirects as unknown[]).length);
  const live = pages.filter((p) => p.status === 200 && !p.noindex && p.canonicalType !== "other" && /^https?:/.test(p.url) && !moved(p));
  const liveUrls = live.map((p) => p.url);
  const impact = (code: string, url: string) => {
    const imp = ctx.impressions?.get(url) ?? 0;
    const p = byUrl.get(url);
    return Math.round(((sevOf[code] ?? 1) * (1 + 0.35 * Math.log10(1 + imp)) + (p?.template === "home" ? 0.5 : 0) + Math.min(0.3, (p?.inlinks ?? 0) / 100)) * 100) / 100;
  };
  const add = (url: string, kind: FixKind, target: string, before: string | null, after: string, reason: string, code: string) => {
    after = kind === "jsonld" || kind === "og" ? after : clean(after);
    if (!after || after === clean(before)) return;
    out.push({ url, kind, target, before: before ? before.slice(0, 4000) : null, after: after.slice(0, 20000), reason, code, impact: impact(code, url || `https://${ctx.domain}/`) });
  };

  // títulos repetidos: cada página del grupo necesita su propio diferenciador
  const titleGroups = new Map<string, FixPage[]>();
  for (const p of live) if (p.title) titleGroups.set(clean(p.title).toLowerCase(), [...(titleGroups.get(clean(p.title).toLowerCase()) ?? []), p]);
  const usedTitles = new Set(live.map((p) => clean(p.title).toLowerCase()).filter(Boolean));

  for (const p of live) {
    const html = p.responseHtml ? load(p.responseHtml) : null;
    const h1 = clean(p.h1[0]);
    const core = titleCore(p.title, brand);
    const topic = h1 || core || capFirst(slugWords(p.url));
    const isHome = p.template === "home" || new URL(p.url).pathname === "/";
    // home con título genérico ("Inicio", "Home"): el tema sale de la primera frase propia de la página
    const generic = GENERIC_TITLE.test(core) || (!core && isHome);
    const pitch = isHome && generic && html ? homePitch(leadText(html)) : "";

    // ── title ────────────────────────────────────────────────────────────────
    let newTitle = "";
    let titleCode = "";
    let titleReason = "";
    if (isHome && generic && pitch) {
      [newTitle, titleCode, titleReason] = [buildTitle(pitch, brand), clean(p.title) ? "title_short" : "title_missing", "El título de la portada no dice qué ofrece el sitio: es lo primero que se lee en Google."];
    } else if (!clean(p.title)) {
      if (topic) [newTitle, titleCode, titleReason] = [buildTitle(topic, brand), "title_missing", "La página no tiene título: es el titular que Google muestra en los resultados."];
    } else if (has(p.url, "title_dup")) {
      const group = titleGroups.get(clean(p.title).toLowerCase()) ?? [];
      const h1Unique = h1 && group.filter((g) => clean(g.h1[0]).toLowerCase() === h1.toLowerCase()).length === 1 && h1.toLowerCase() !== core.toLowerCase();
      const diff = h1Unique ? h1 : slugWords(p.url) ? (strip(core).includes(strip(slugWords(p.url))) ? "" : `${core} – ${capFirst(slugWords(p.url))}`) : "";
      if (diff) [newTitle, titleCode, titleReason] = [buildTitle(diff, brand), "title_dup", `${group.length} páginas comparten este título y compiten entre sí: cada una necesita el suyo.`];
    } else if (has(p.url, "title_short") && h1 && h1.length > core.length + 5) {
      [newTitle, titleCode, titleReason] = [buildTitle(h1, brand), "title_short", "El título es muy corto: no dice qué ofrece la página."];
    } else if (has(p.url, "title_long")) {
      [newTitle, titleCode, titleReason] = [buildTitle(core, brand), "title_long", "El título se corta en los resultados de Google: esta versión cabe completa."];
    }
    // Search Console: la consulta con más impresiones no aparece en el título y la página está a tiro de la primera página
    if (!newTitle && ctx.queries) {
      const q = (ctx.queries.get(p.url) ?? []).filter((x) => x.position >= 3 && x.position <= 20 && x.impressions >= 30 && !strip(x.query).includes(strip(brand))).sort((a, b) => b.impressions - a.impressions)[0];
      if (q) {
        const tks = strip(q.query).split(/\s+/).filter((t) => t.length > 2 && !STOP_ES.has(t));
        const tl = strip(p.title ?? "");
        if (tks.length && tks.filter((t) => tl.includes(t)).length / tks.length < 0.6) {
          const merged = `${capFirst(q.query)} – ${core}`;
          [newTitle, titleCode, titleReason] = [buildTitle(merged.length <= TITLE_MAX - brand.length - 3 ? merged : capFirst(q.query), brand), "gsc_ctr", `La búsqueda «${q.query}» trae ${q.impressions} impresiones en posición ${q.position.toFixed(1)} y el título no la menciona.`];
        }
      }
    }
    let finalTitle = clean(p.title);
    if (newTitle && newTitle.toLowerCase() !== clean(p.title).toLowerCase() && !(usedTitles.has(newTitle.toLowerCase()) && titleCode !== "title_long")) {
      usedTitles.add(newTitle.toLowerCase());
      add(p.url, "title", "", p.title, newTitle, titleReason, titleCode);
      finalTitle = newTitle;
    }
    let finalMeta = clean(p.metaDesc);

    // ── meta description ─────────────────────────────────────────────────────
    const metaCode = !clean(p.metaDesc) ? "meta_missing" : has(p.url, "meta_dup") ? "meta_dup" : has(p.url, "meta_short") ? "meta_short" : has(p.url, "meta_long") ? "meta_long" : "";
    if (metaCode) {
      let m = "";
      if (metaCode === "meta_long") m = buildMeta(p.metaDesc!);
      else {
        const lead = html ? leadText(html) : "";
        m = lead.length >= META_MIN ? buildMeta(lead) : metaCode === "meta_short" ? "" : topic && fallbackMeta(p, topic, brand) ? buildMeta(fallbackMeta(p, topic, brand)) : "";
      }
      const why = {
        meta_missing: "Sin descripción, Google arma el texto bajo el título por su cuenta. Esta sale del contenido de la página.",
        meta_dup: "Varias páginas usan la misma descripción: esta es propia de la página.",
        meta_short: "La descripción actual es muy corta: esta aprovecha el espacio con el contenido de la página.",
        meta_long: "La descripción se corta en los resultados: esta versión termina en una frase completa.",
      }[metaCode]!;
      if (m && m.length >= 50) {
        add(p.url, "meta", "", p.metaDesc, m, why, metaCode);
        finalMeta = m;
      }
    }

    // ── H1 ───────────────────────────────────────────────────────────────────
    if (!p.h1.length && (pitch || (core && !generic))) add(p.url, "h1", "", null, capFirst(pitch || core), "La página no tiene encabezado principal (H1): este sale de su título.", "h1_missing");

    // ── canonical ────────────────────────────────────────────────────────────
    if (!p.canonical && has(p.url, "canonical_missing")) {
      const u = new URL(p.url);
      for (const k of [...u.searchParams.keys()]) if (/^(utm_.*|gclid|fbclid|msclkid|_ga|_gl|ref)$/i.test(k)) u.searchParams.delete(k);
      add(p.url, "canonical", "", null, u.toString(), "Sin canonical, Google elige por su cuenta entre las variantes de la URL (parámetros, mayúsculas).", "canonical_missing");
    }

    // ── hreflang autorreferente ──────────────────────────────────────────────
    if (has(p.url, "hreflang_no_self")) {
      const hl = (Array.isArray(p.hreflang) ? p.hreflang : []) as { lang: string; href: string }[];
      const lang = hl.some((h) => h.lang.toLowerCase() === ctx.language.toLowerCase()) ? "" : ctx.language;
      if (lang) add(p.url, "hreflang", lang, null, p.url, `Las versiones por idioma deben incluirse a sí mismas: falta la etiqueta hreflang="${lang}" de esta página.`, "hreflang_no_self");
    }

    // ── imágenes sin alt ─────────────────────────────────────────────────────
    let n = 0;
    for (const img of imagesOf(p)) {
      if (img.alt != null || !img.src || /^data:/.test(img.src) || ((img.width ?? 99) <= 2 && (img.height ?? 99) <= 2)) continue;
      const alt = altFor(img.src, topic, n);
      if (alt) add(p.url, "alt", img.src, null, alt, "Imagen sin texto alternativo: Google Imágenes y los lectores de pantalla no saben qué muestra.", "img_no_alt");
      if (++n >= 15) break;
    }

    if (!html) continue;
    // ── Open Graph (cómo se ve el enlace al compartirlo) ─────────────────────
    const ogTitle = html('meta[property="og:title"]').attr("content");
    if (!ogTitle && topic) {
      const desc = finalMeta || buildMeta(leadText(html));
      const image = imagesOf(p).find((i) => i.src && !/^data:/.test(i.src) && !/\.svg(\?|$)/i.test(i.src) && (i.width ?? 300) >= 200)?.src;
      const tags: Record<string, string> = { "og:title": finalTitle || topic, ...(desc ? { "og:description": desc } : {}), "og:url": p.url, "og:type": p.template === "article" ? "article" : p.template === "product" ? "product" : "website", "og:site_name": brand, ...(image ? { "og:image": image } : {}), "twitter:card": image ? "summary_large_image" : "summary" };
      add(p.url, "og", "", null, JSON.stringify(tags), "Sin etiquetas Open Graph, el enlace se comparte en WhatsApp, Facebook o LinkedIn sin título ni imagen propios.", "og_missing");
    }

    // ── JSON-LD desde lo que la página muestra ───────────────────────────────
    const types = new Set(p.jsonldTypes.map((t) => t.toLowerCase()));
    const firstImg = imagesOf(p).find((i) => i.src && !/^data:/.test(i.src) && !/\.svg(\?|$)/i.test(i.src) && (i.width ?? 300) >= 200)?.src;
    if (isHome && !["organization", "localbusiness", "store", "corporation", "onlinestore"].some((t) => types.has(t))) {
      const logo = html('link[rel="apple-touch-icon"]').attr("href") ?? html('meta[property="og:image"]').attr("content") ?? html('link[rel="icon"]').attr("href");
      let logoUrl: string | undefined;
      try {
        if (logo) logoUrl = new URL(logo, p.url).href;
      } catch {}
      const same = [...new Set(html('a[href*="instagram.com/"],a[href*="facebook.com/"],a[href*="linkedin.com/"],a[href*="tiktok.com/@"],a[href*="youtube.com/"],a[href*="x.com/"]').map((_, a) => html(a).attr("href")!).get().filter((h) => /^https?:\/\//.test(h) && !/sharer|share\?|intent\//.test(h)))].slice(0, 6);
      add(p.url, "jsonld", "Organization", null, ld({ "@context": "https://schema.org", "@type": "Organization", name: brand, url: new URL("/", p.url).href, ...(logoUrl ? { logo: logoUrl } : {}), ...(same.length ? { sameAs: same } : {}) }), "La home no declara la organización: con este marcado Google asocia el sitio con la marca, su logo y sus redes.", "schema_missing");
    }
    const c = commerceOf(p);
    const price = c.price != null ? Number(String(c.price).replace(/[^\d.,]/g, "").replace(/\.(?=\d{3})/g, "").replace(",", ".")) : NaN;
    if (p.template === "product" && !types.has("product") && !types.has("productgroup") && Number.isFinite(price) && price > 0 && c.currency && topic) {
      const avail = AVAIL[strip(String(c.availability ?? "")).replace(/[^a-z]/g, "")];
      add(p.url, "jsonld", "Product", null, ld({ "@context": "https://schema.org", "@type": "Product", name: clean(c.name) || topic, ...(firstImg ? { image: [firstImg] } : {}), ...(finalMeta ? { description: finalMeta } : {}), ...(c.sku ? { sku: String(c.sku) } : {}), brand: { "@type": "Brand", name: brand }, offers: { "@type": "Offer", url: p.url, price, priceCurrency: String(c.currency).toUpperCase(), ...(avail ? { availability: avail } : {}) } }), "La ficha muestra precio pero no tiene datos estructurados de producto: sin ellos no puede mostrar precio y stock en Google.", "schema_missing");
    }
    if (p.template === "article" && !["article", "blogposting", "newsarticle"].some((t) => types.has(t)) && topic) {
      const published = html('meta[property="article:published_time"]').attr("content") ?? html("time[datetime]").first().attr("datetime");
      const author = clean(html('meta[name="author"]').attr("content") ?? html('[rel="author"]').first().text());
      add(p.url, "jsonld", "Article", null, ld({ "@context": "https://schema.org", "@type": "Article", headline: topic.slice(0, 110), ...(firstImg ? { image: [firstImg] } : {}), ...(published && !Number.isNaN(Date.parse(published)) ? { datePublished: new Date(published).toISOString() } : {}), ...(author ? { author: { "@type": "Person", name: author } } : {}), publisher: { "@type": "Organization", name: brand }, mainEntityOfPage: p.url }), "El artículo no tiene datos estructurados: con ellos Google identifica titular, imagen y autor.", "schema_missing");
    }
    if (!types.has("faqpage")) {
      const faq = visibleFaq(html);
      if (faq.length >= 2) add(p.url, "jsonld", "FAQPage", null, ld({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }), `La página muestra ${faq.length} preguntas con respuesta y no las declara: este marcado usa exactamente el texto visible.`, "faq_schema");
    }
  }

  // ── links rotos: un reemplazo por destino, vale para todas las páginas que lo enlazan ──
  const broken = new Map<string, number>();
  for (const i of ctx.issues) if (i.code === "broken_link" && i.detail && /^https?:/.test(i.detail)) broken.set(i.detail, (broken.get(i.detail) ?? 0) + 1);
  for (const [target, count] of broken) {
    const m = bestMatch(target, liveUrls);
    if (m) add("", "link", target, target, m.url, `${count} ${count === 1 ? "página enlaza" : "páginas enlazan"} a esta URL que da error: el link pasa a apuntar a la página equivalente.`, "broken_link");
  }
  // links internos a URLs que redirigen: apuntar directo al destino final
  const redirected = new Map(pages.filter((p) => p.status === 200 && p.finalUrl && p.finalUrl !== p.url && Array.isArray(p.redirects) && (p.redirects as unknown[]).length > 0).map((p) => [p.url, p.finalUrl!]));

  // ── redirecciones (archivo para el servidor) ─────────────────────────────
  const linked = new Set<string>(broken.keys());
  for (const p of pages) {
    if (!(p.status >= 400 && p.status < 500) || [401, 403, 429].includes(p.status)) continue;
    if (!linked.has(p.url) && !p.inSitemap && !(ctx.impressions?.get(p.url) ?? 0) && !(p.inlinks ?? 0)) continue;
    const m = bestMatch(p.url, liveUrls);
    if (m) add("", "redirect", p.url, `${p.status}`, m.url, `Responde ${p.status}${p.inSitemap ? " y está en el sitemap" : ""}${linked.has(p.url) ? " y tiene links internos" : ""}: un 301 a la página equivalente conserva las visitas y la autoridad.`, "http_4xx");
  }
  for (const [from, to] of redirected) {
    const p = byUrl.get(from)!;
    if ((p.redirects as unknown[]).length > 1) add("", "redirect", from, `${(p.redirects as unknown[]).length} saltos`, to, "Cadena de redirecciones: un solo 301 directo al destino final carga más rápido y no pierde autoridad en cada salto.", "redirect_chain");
  }
  return out.sort((a, b) => b.impact - a.impact);
}

/** Valor actual del elemento en la página, para saber si el sitio ya trae la corrección en su HTML. */
export function currentValue(p: FixPage, kind: string, target: string): string | null {
  if (kind === "title") return clean(p.title) || null;
  if (kind === "meta") return clean(p.metaDesc) || null;
  if (kind === "h1") return clean(p.h1[0]) || null;
  if (kind === "canonical") return p.canonical;
  if (kind === "alt") return imagesOf(p).find((i) => i.src === target)?.alt ?? null;
  if (kind === "jsonld") return p.jsonldTypes.some((t) => t.toLowerCase() === target.toLowerCase()) ? target : null;
  if (kind === "hreflang") return ((Array.isArray(p.hreflang) ? p.hreflang : []) as { href: string }[]).some((h) => h.href === p.url) ? p.url : null;
  if (kind === "link") return p.links?.includes(target) ? target : null;
  return null;
}
