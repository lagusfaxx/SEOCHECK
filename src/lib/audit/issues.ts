import type { Page } from "@prisma/client";
import { computeExtraIssues, EXTRA_ISSUE_LABELS } from "./issues-extra";
import { isParamCanonical, serpWidthPx, TITLE_MAX_PX, META_MAX_PX } from "../report-rules";

export type IssueRow = { url: string; code: string; severity: "critical" | "warning" | "info"; detail?: string };

export const ISSUE_LABELS: Record<string, string> = {
  http_4xx: "Error 4xx",
  http_5xx: "Error 5xx",
  fetch_failed: "No responde",
  blocked_by_waf: "Bloqueada por WAF (Cloudflare)",
  ssrf_blocked: "URL bloqueada (red interna)",
  redirect_chain: "Cadena de redirects",
  redirect: "Redirect",
  broken_link: "Link roto",
  noindex_in_sitemap: "noindex en sitemap",
  title_missing: "Sin título",
  title_long: "Título que puede cortarse",
  title_short: "Título corto",
  title_dup: "Título duplicado",
  meta_missing: "Sin meta description",
  meta_long: "Meta que puede cortarse",
  meta_short: "Meta corta",
  meta_dup: "Meta duplicada",
  h1_missing: "Sin H1",
  h1_multiple: "Varios H1",
  canonical_missing: "Sin canonical",
  canonical_other: "Canonical a otra URL",
  canonical_bad_target: "Canonical hacia una URL que no es válida",
  jsonld_invalid: "JSON-LD inválido",
  jsonld_mismatch: "Datos estructurados que no coinciden con lo visible",
  js_dependent: "Contenido o links que dependen de JavaScript",
  thin_content: "Poco texto visible",
  dup_content: "Contenido duplicado",
  img_no_alt: "Imágenes sin alt",
  deep_page: "Profundidad > 3",
  orphan: "En sitemap sin enlace encontrado",
  slow: "Respuesta lenta",
  no_inlinks: "Sin links entrantes",
  robots_missing: "Sin robots.txt",
  sitemap_missing: "Sin sitemap",
  blocked_robots: "Bloqueada por robots",
  hreflang_no_self: "hreflang sin auto-referencia",
  noindex: "noindex",
  nofollow: "nofollow en la única vía a otras URLs",
  ...EXTRA_ISSUE_LABELS,
};

/** Por debajo de esto la página casi no tiene texto propio; no es un objetivo de largo. */
export const THIN_WORDS = 100;

/** Evidencia de un error HTTP: estado, URL final, de dónde viene (sitemap o links) y quién la enlaza. */
export function httpEvidence(p: Pick<Page, "status" | "finalUrl" | "url" | "inSitemap">, from: string[]): string {
  const parts = [`HTTP ${p.status}`];
  if (p.finalUrl && p.finalUrl !== p.url) parts.push(`URL final ${p.finalUrl}`);
  const origin = [p.inSitemap ? "en sitemap" : "", from.length ? `enlazada desde ${from.slice(0, 3).join(" ")}${from.length > 3 ? ` (+${from.length - 3})` : ""}` : ""].filter(Boolean);
  parts.push(origin.length ? origin.join("; ") : "sin origen registrado (descubierta por redirect o URL de inicio)");
  return parts.join(" · ");
}

/** Problema del destino de un canonical, si lo hay y se pudo comprobar en el crawl. */
export function canonicalTargetProblem(target: string | null, pageOf: Map<string, Page>): string | null {
  if (!target) return null;
  const t = pageOf.get(target);
  if (!t) return null; // no se rastreó: no se puede afirmar nada
  if (t.blocked) return "destino bloqueado por robots.txt";
  if (t.status === 0) return "el destino no respondió";
  if (t.status >= 400) return `el destino responde HTTP ${t.status}`;
  if ((t.redirects as unknown[]).length) return `el destino redirige a ${t.finalUrl}`;
  if (t.noindex) return "el destino tiene noindex";
  if (t.canonicalType === "other" && t.canonical !== target) return `el destino declara otro canonical (${t.canonical})`;
  return null;
}

export function computeIssues(pages: Page[], ctx: { robotsTxt: string | null; sitemapCount: number; site: string }): IssueRow[] {
  const out: IssueRow[] = [];
  const add = (url: string, code: string, severity: IssueRow["severity"], detail?: string) => out.push({ url, code, severity, detail });
  const statusOf = new Map<string, number>();
  const blockedSet = new Set<string>();
  const pageOf = new Map<string, Page>();
  // quién enlaza a cada URL: evidencia para 4xx, huérfanas y nofollow
  const linkedFrom = new Map<string, string[]>();
  for (const p of pages) {
    statusOf.set(p.url, p.status);
    pageOf.set(p.url, p);
    if (p.blocked) blockedSet.add(p.url);
    for (const l of new Set(p.links)) if (l !== p.url) linkedFrom.set(l, [...(linkedFrom.get(l) ?? []), p.url]);
  }

  if (!ctx.robotsTxt) add(`https://${ctx.site}/robots.txt`, "robots_missing", "warning");
  if (!ctx.sitemapCount) add(`https://${ctx.site}/sitemap.xml`, "sitemap_missing", "warning");

  const html = pages.filter((p) => p.status === 200 && !p.error && (p.contentType ?? "").includes("html"));
  const group = (key: (p: Page) => string | null) => {
    const m = new Map<string, Page[]>();
    for (const p of html) {
      if (p.noindex || p.canonicalType === "other" || (p.redirects as unknown[]).length) continue;
      const k = key(p);
      if (!k) continue;
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return [...m.values()].filter((g) => g.length > 1);
  };

  for (const p of pages) {
    const redirects = (p.redirects as { url: string; status: number }[]) ?? [];
    if (p.blocked) { add(p.url, "blocked_robots", p.inSitemap ? "warning" : "info"); continue; }
    if (p.error === "blocked_by_waf") { add(p.url, "blocked_by_waf", "critical", `HTTP ${p.status}`); continue; }
    if (p.error === "ssrf_blocked") { add(p.url, "ssrf_blocked", "warning"); continue; }
    if (p.status === 0) { add(p.url, "fetch_failed", "critical"); continue; }
    if (p.status >= 500) add(p.url, "http_5xx", "critical", httpEvidence(p, linkedFrom.get(p.url) ?? []));
    else if (p.status >= 400) add(p.url, "http_4xx", "critical", httpEvidence(p, linkedFrom.get(p.url) ?? []));
    if (redirects.length > 1) add(p.url, "redirect_chain", "warning", [...redirects.map((r) => `${r.status} ${r.url}`), p.finalUrl ?? ""].join(" → "));
    else if (redirects.length === 1 && p.inSitemap) add(p.url, "redirect", "warning", `→ ${p.finalUrl}`);
    // no encontrar el link en el HTML no prueba que no exista (links condicionales o armados con JS): es una hipótesis
    if (p.orphan) add(p.url, "orphan", "info", "en sitemap; no se encontró un link en el HTML rastreado");
    if (redirects.length) continue;
    if (p.status !== 200 || !(p.contentType ?? "").includes("html")) continue;

    if (p.noindex) add(p.url, p.inSitemap ? "noindex_in_sitemap" : "noindex", p.inSitemap ? "critical" : "info");
    // nofollow solo importa si la página es la única vía hacia otras URLs: si esas URLs se enlazan desde otras
    // páginas, Google las descubre igual y no hay una pérdida demostrable
    if (p.nofollow) {
      const only = p.links.filter((l) => l !== p.url && pageOf.has(l) && (linkedFrom.get(l) ?? []).every((src) => pageOf.get(src)?.nofollow));
      if (only.length) add(p.url, "nofollow", "info", `${p.noindex ? "noindex, nofollow" : "nofollow"} · ${only.length} URL${only.length === 1 ? "" : "s"} solo enlazada${only.length === 1 ? "" : "s"} desde páginas nofollow: ${only.slice(0, 3).join(" ")}`);
    }
    if (!p.title) add(p.url, "title_missing", "critical");
    // los largos son orientativos: Google corta por ancho (~600 px), no por caracteres, y puede reescribir el title
    else if (serpWidthPx(p.title, 20) > TITLE_MAX_PX) add(p.url, "title_long", "info", `${p.titleLen} caracteres, ~${serpWidthPx(p.title, 20)} px estimados`);
    else if (p.titleLen < 25) add(p.url, "title_short", "info", `${p.titleLen}`);
    if (!p.metaDesc) add(p.url, "meta_missing", "warning");
    else if (serpWidthPx(p.metaDesc, 14) > META_MAX_PX) add(p.url, "meta_long", "info", `${p.metaLen} caracteres, ~${serpWidthPx(p.metaDesc, 14)} px estimados`);
    else if (p.metaLen < 70) add(p.url, "meta_short", "info", `${p.metaLen}`);
    if (!p.h1.length) add(p.url, "h1_missing", "warning");
    else if (p.h1.length > 1) add(p.url, "h1_multiple", "info", `${p.h1.length} H1: ${p.h1.slice(0, 3).map((h) => `«${h.slice(0, 60)}»`).join(", ")}`);
    if (p.canonicalType === "none") add(p.url, "canonical_missing", "info");
    // canonical de una URL con parámetros hacia su versión sin parámetros (filtros, ?variant=…): es lo correcto
    if (p.canonicalType === "other" && !isParamCanonical(p.url, p.canonical)) {
      // consolidar variantes (modelos, colores, parámetros) en una ficha es intencional; el error es apuntar a algo roto
      const bad = canonicalTargetProblem(p.canonical, pageOf);
      if (bad) add(p.url, "canonical_bad_target", "warning", `${p.canonical} · ${bad}`);
      else add(p.url, "canonical_other", "info", p.canonical ?? "");
    }
    if (p.jsonldErrors) add(p.url, "jsonld_invalid", "warning", `${p.jsonldErrors} bloque${p.jsonldErrors === 1 ? "" : "s"} JSON-LD que no se pueden leer`);
    if (p.schemaIssues?.length) add(p.url, "jsonld_mismatch", "warning", p.schemaIssues.join("; "));
    // solo se sabe con render JS: el HTML inicial no trae links o la mitad del texto
    const jsWords = p.rawWordCount != null && p.wordCount >= 100 && p.rawWordCount < p.wordCount * 0.5;
    if (p.jsLinks > 0 || jsWords) add(p.url, "js_dependent", "info", [p.jsLinks ? `${p.jsLinks} links solo aparecen al ejecutar JavaScript` : "", jsWords ? `${p.rawWordCount} de ${p.wordCount} palabras en el HTML inicial` : ""].filter(Boolean).join(" · "));
    // poco texto no es baja calidad por sí solo (fichas, listados): solo se anota casi sin texto, como hipótesis
    if (p.wordCount < THIN_WORDS && !p.noindex) add(p.url, "thin_content", "info", `${p.wordCount} palabras visibles`);
    if (p.imgNoAlt) add(p.url, "img_no_alt", "info", `${p.imgNoAlt} imagen${p.imgNoAlt === 1 ? "" : "es"} sin atributo alt`);
    if (p.depth > 3) add(p.url, "deep_page", "warning", `a ${p.depth} clics de la home`);
    if (p.responseMs > 1500) add(p.url, "slow", p.responseMs > 3000 ? "warning" : "info", `${p.responseMs} ms`);
    if (!p.inlinks && p.depth !== 0 && !p.orphan) add(p.url, "no_inlinks", "warning");
    const hl = p.hreflang as { lang: string; href: string }[];
    // el hreflang se evalúa en la versión canónica: una página con canonical a otra URL no necesita auto-referencia
    if (hl.length && p.canonicalType !== "other" && !hl.some((h) => h.href === p.url)) add(p.url, "hreflang_no_self", "warning");
    for (const l of p.links) {
      const s = statusOf.get(l);
      // roto = el destino no existe (404/410…). 401/403 (privado), 429 (límite de ritmo) y fallas de conexión no son links rotos
      if (s != null && s >= 400 && s < 500 && ![401, 403, 429].includes(s) && !blockedSet.has(l)) add(p.url, "broken_link", "critical", l);
    }
  }
  for (const g of group((p) => p.title)) for (const p of g) add(p.url, "title_dup", "warning", `mismo title en ${g.length} páginas: «${(p.title ?? "").slice(0, 80)}»`);
  for (const g of group((p) => p.metaDesc)) for (const p of g) add(p.url, "meta_dup", "info", `misma descripción en ${g.length} páginas: «${(p.metaDesc ?? "").slice(0, 80)}…»`);
  for (const g of group((p) => (p.wordCount > 50 ? p.contentHash : null))) for (const p of g) add(p.url, "dup_content", "warning", g.filter((x) => x !== p).map((x) => x.url).slice(0, 3).join(" "));
  out.push(...computeExtraIssues(pages, { site: ctx.site }));
  return out;
}


/** Detalle con unidad para mostrar. Los crawls anteriores guardaban solo el número ("2", "23"). */
export function detailText(code: string, detail: string | null | undefined): string {
  if (!detail) return "";
  if (!/^\d+$/.test(detail.trim())) return detail;
  const n = Number(detail);
  const unit: Record<string, string> = {
    title_dup: `mismo title en ${n} páginas`, meta_dup: `misma descripción en ${n} páginas`, img_no_alt: `${n} imágenes sin alt`,
    jsonld_invalid: `${n} bloques JSON-LD con error`, h1_multiple: `${n} H1`, deep_page: `a ${n} clics de la home`,
    title_long: `${n} caracteres`, title_short: `${n} caracteres`, meta_long: `${n} caracteres`, meta_short: `${n} caracteres`,
    thin_content: `${n} palabras visibles`, http_4xx: `HTTP ${n}`, http_5xx: `HTTP ${n}`,
  };
  return unit[code] ?? detail;
}
