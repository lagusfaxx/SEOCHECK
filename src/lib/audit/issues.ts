import type { Page } from "@prisma/client";

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
  title_missing: "Sin title",
  title_long: "Title largo",
  title_short: "Title corto",
  title_dup: "Title duplicado",
  meta_missing: "Sin meta description",
  meta_long: "Meta larga",
  meta_short: "Meta corta",
  meta_dup: "Meta duplicada",
  h1_missing: "Sin H1",
  h1_multiple: "Varios H1",
  canonical_missing: "Sin canonical",
  canonical_other: "Canonical a otra URL",
  jsonld_invalid: "JSON-LD inválido",
  thin_content: "Contenido pobre",
  dup_content: "Contenido duplicado",
  img_no_alt: "Imágenes sin alt",
  deep_page: "Profundidad > 3",
  orphan: "Huérfana",
  slow: "Respuesta lenta",
  no_inlinks: "Sin links entrantes",
  robots_missing: "Sin robots.txt",
  sitemap_missing: "Sin sitemap",
  blocked_robots: "Bloqueada por robots",
  hreflang_no_self: "hreflang sin auto-referencia",
  noindex: "noindex",
};

export function computeIssues(pages: Page[], ctx: { robotsTxt: string | null; sitemapCount: number; site: string }): IssueRow[] {
  const out: IssueRow[] = [];
  const add = (url: string, code: string, severity: IssueRow["severity"], detail?: string) => out.push({ url, code, severity, detail });
  const statusOf = new Map<string, number>();
  const blockedSet = new Set<string>();
  for (const p of pages) {
    statusOf.set(p.url, p.status);
    if (p.blocked) blockedSet.add(p.url);
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
    if (p.status >= 500) add(p.url, "http_5xx", "critical", String(p.status));
    else if (p.status >= 400) add(p.url, "http_4xx", "critical", String(p.status));
    if (redirects.length > 1) add(p.url, "redirect_chain", "warning", [...redirects.map((r) => `${r.status} ${r.url}`), p.finalUrl ?? ""].join(" → "));
    else if (redirects.length === 1 && p.inSitemap) add(p.url, "redirect", "warning", `→ ${p.finalUrl}`);
    if (p.orphan) add(p.url, "orphan", "warning");
    if (redirects.length) continue;
    if (p.status !== 200 || !(p.contentType ?? "").includes("html")) continue;

    if (p.noindex) add(p.url, p.inSitemap ? "noindex_in_sitemap" : "noindex", p.inSitemap ? "critical" : "info");
    if (!p.title) add(p.url, "title_missing", "critical");
    else if (p.titleLen > 60) add(p.url, "title_long", "warning", `${p.titleLen}`);
    else if (p.titleLen < 25) add(p.url, "title_short", "info", `${p.titleLen}`);
    if (!p.metaDesc) add(p.url, "meta_missing", "warning");
    else if (p.metaLen > 160) add(p.url, "meta_long", "info", `${p.metaLen}`);
    else if (p.metaLen < 70) add(p.url, "meta_short", "info", `${p.metaLen}`);
    if (!p.h1.length) add(p.url, "h1_missing", "warning");
    else if (p.h1.length > 1) add(p.url, "h1_multiple", "info", `${p.h1.length}`);
    if (p.canonicalType === "none") add(p.url, "canonical_missing", "info");
    if (p.canonicalType === "other") add(p.url, "canonical_other", "info", p.canonical ?? "");
    if (p.jsonldErrors) add(p.url, "jsonld_invalid", "warning", `${p.jsonldErrors}`);
    if (p.wordCount < 250 && !p.noindex) add(p.url, "thin_content", "info", `${p.wordCount}`);
    if (p.imgNoAlt) add(p.url, "img_no_alt", "info", `${p.imgNoAlt}`);
    if (p.depth > 3) add(p.url, "deep_page", "warning", `${p.depth}`);
    if (p.responseMs > 1500) add(p.url, "slow", p.responseMs > 3000 ? "warning" : "info", `${p.responseMs} ms`);
    if (!p.inlinks && p.depth !== 0 && !p.orphan) add(p.url, "no_inlinks", "warning");
    const hl = p.hreflang as { lang: string; href: string }[];
    if (hl.length && !hl.some((h) => h.href === p.url)) add(p.url, "hreflang_no_self", "warning");
    for (const l of p.links) {
      const s = statusOf.get(l);
      if (s != null && (s >= 400 || s === 0) && !blockedSet.has(l)) add(p.url, "broken_link", "critical", l);
    }
  }
  for (const g of group((p) => p.title)) for (const p of g) add(p.url, "title_dup", "warning", `${g.length}`);
  for (const g of group((p) => p.metaDesc)) for (const p of g) add(p.url, "meta_dup", "info", `${g.length}`);
  for (const g of group((p) => (p.wordCount > 50 ? p.contentHash : null))) for (const p of g) add(p.url, "dup_content", "warning", g.filter((x) => x !== p).map((x) => x.url).slice(0, 3).join(" "));
  return out;
}
