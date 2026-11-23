/**
 * Archivos listos para subir al sitio: redirecciones en el formato de cada servidor, robots.txt, sitemap.xml,
 * CSV de títulos y descripciones, etiquetas HTML por página y las instrucciones para un programador o un
 * asistente de código. Funciones puras.
 */
import { PRIVATE_PATH } from "../report-rules";
import { csvCell } from "../reporting";

export type FileFix = { url: string; kind: string; target: string; before: string | null; after: string; reason: string };
export type Redirect = { from: string; to: string };

export const REDIRECT_FORMATS = {
  apache: { label: "Apache (.htaccess)", file: ".htaccess", type: "text/plain" },
  nginx: { label: "Nginx", file: "redirects.conf", type: "text/plain" },
  next: { label: "Next.js (next.config)", file: "redirects.js", type: "text/javascript" },
  vercel: { label: "Vercel (vercel.json)", file: "vercel.json", type: "application/json" },
  netlify: { label: "Netlify / Cloudflare Pages (_redirects)", file: "_redirects", type: "text/plain" },
  shopify: { label: "Shopify (importar CSV)", file: "redirects-shopify.csv", type: "text/csv" },
  wordpress: { label: "WordPress (plugin Redirection, CSV)", file: "redirects-wordpress.csv", type: "text/csv" },
} as const;
export type RedirectFormat = keyof typeof REDIRECT_FORMATS;

const pathOf = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};
const sameHost = (a: string, b: string) => {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
};
/** Destino relativo si es del mismo sitio; absoluto si no. */
const dest = (r: Redirect) => (sameHost(r.from, r.to) ? pathOf(r.to) : r.to);
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const csv = (rows: unknown[][]) => "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");

export function redirectsOf(fixes: FileFix[]): Redirect[] {
  const seen = new Set<string>();
  return fixes.filter((f) => f.kind === "redirect" && f.target && f.after && !seen.has(f.target) && seen.add(f.target)).map((f) => ({ from: f.target, to: f.after }));
}

export function redirectFile(format: RedirectFormat, list: Redirect[]): string {
  const rs = list.filter((r) => pathOf(r.from) !== dest(r));
  switch (format) {
    case "apache":
      // RewriteRule con ancla exacta: Redirect 301 de mod_alias también captura las subrutas
      return ["# Redirecciones 301 generadas por FSV Search", "RewriteEngine On", ...rs.map((r) => {
        const [p, q] = pathOf(r.from).split("?");
        const rule = `RewriteRule ^${reEsc(p.replace(/^\//, ""))}/?$ ${dest(r)} [R=301,L${q ? "" : ",QSD"}]`;
        return q ? `RewriteCond %{QUERY_STRING} ^${reEsc(q)}$\n${rule.replace("[R=301,L]", "[R=301,L,QSD]")}` : rule;
      })].join("\n") + "\n";
    case "nginx":
      return ["# Redirecciones 301 generadas por FSV Search: pegar dentro del bloque server { }", ...rs.map((r) => `location = ${pathOf(r.from).split("?")[0]} { return 301 ${dest(r)}; }`)].join("\n") + "\n";
    case "next":
      return `// Redirecciones 301 generadas por FSV Search. En next.config.js:\n//   async redirects() { return require("./redirects.js"); }\nmodule.exports = ${JSON.stringify(rs.map((r) => ({ source: pathOf(r.from).split("?")[0], destination: dest(r), permanent: true })), null, 2)};\n`;
    case "vercel":
      return JSON.stringify({ redirects: rs.map((r) => ({ source: pathOf(r.from).split("?")[0], destination: dest(r), permanent: true })) }, null, 2) + "\n";
    case "netlify":
      return ["# Redirecciones 301 generadas por FSV Search", ...rs.map((r) => `${pathOf(r.from).split("?")[0]}  ${dest(r)}  301`)].join("\n") + "\n";
    case "shopify":
      return csv([["Redirect from", "Redirect to"], ...rs.map((r) => [pathOf(r.from), dest(r)])]);
    case "wordpress":
      return csv([["source", "target", "regex", "code", "type"], ...rs.map((r) => [pathOf(r.from), dest(r), 0, 301, "url"])]);
  }
}

export type SitePage = { url: string; status: number; noindex: boolean; canonicalType: string | null; blocked?: boolean; lastmod?: Date | string | null; template?: string | null };

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** URLs que corresponde ofrecer a Google: responden 200, se pueden indexar y son su propia versión principal. */
export const indexable = (pages: SitePage[]) =>
  pages.filter((p) => p.status === 200 && !p.noindex && !p.blocked && p.canonicalType !== "other" && /^https?:\/\//.test(p.url) && !PRIVATE_PATH.test(pathOf(p.url)) && !/[?&](utm_|gclid|fbclid|sort|order|orderby)=/i.test(p.url));

export function sitemapXml(pages: SitePage[]): string {
  const rows = indexable(pages).sort((a, b) => a.url.localeCompare(b.url)).slice(0, 50_000);
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...rows.map((p) => {
    const d = p.lastmod ? new Date(p.lastmod) : null;
    return `  <url><loc>${xml(p.url)}</loc>${d && !Number.isNaN(+d) ? `<lastmod>${d.toISOString().slice(0, 10)}</lastmod>` : ""}</url>`;
  }), "</urlset>", ""].join("\n");
}

/**
 * robots.txt recomendado: conserva las reglas actuales, agrega el bloqueo de las zonas privadas que el crawl
 * encontró (carrito, cuenta, checkout) y declara el sitemap. No bloquea CSS/JS ni páginas indexables.
 */
export function robotsTxt(o: { current: string | null; origin: string; pages: SitePage[]; sitemapUrl?: string | null }): string {
  const current = (o.current ?? "").replace(/\r/g, "").trim();
  const sitemap = o.sitemapUrl || `${o.origin}/sitemap.xml`;
  const privateDirs = new Set<string>();
  for (const p of o.pages) {
    const m = pathOf(p.url).match(PRIVATE_PATH);
    if (m) privateDirs.add(`/${m[1].toLowerCase()}`);
  }
  if (!current) {
    return ["User-agent: *", ...(privateDirs.size ? [...privateDirs].sort().map((d) => `Disallow: ${d}`) : ["Disallow:"]), "", `Sitemap: ${sitemap}`, ""].join("\n");
  }
  const lines = current.split("\n");
  const hasSitemap = lines.some((l) => /^\s*sitemap\s*:/i.test(l));
  const disallowed = new Set(lines.map((l) => l.match(/^\s*disallow\s*:\s*(\S+)/i)?.[1]?.replace(/\/?\*?$/, "").toLowerCase()).filter(Boolean) as string[]);
  const missing = [...privateDirs].filter((d) => ![...disallowed].some((x) => d.startsWith(x))).sort();
  // las reglas nuevas van dentro del grupo "User-agent: *" existente; si no hay, se crea uno
  const star = lines.findIndex((l) => /^\s*user-agent\s*:\s*\*\s*$/i.test(l));
  if (missing.length) {
    if (star >= 0) {
      let end = star + 1;
      while (end < lines.length && lines[end].trim() && !/^\s*(user-agent|sitemap)\s*:/i.test(lines[end])) end++;
      lines.splice(end, 0, ...missing.map((d) => `Disallow: ${d}`));
    } else lines.push("", "User-agent: *", ...missing.map((d) => `Disallow: ${d}`));
  }
  if (!hasSitemap) lines.push("", `Sitemap: ${sitemap}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const jsonScript = (s: string) => s.replace(/</g, "\\u003c");

/** La corrección como HTML para pegar en la página o en la plantilla. */
export function fixHtml(f: FileFix): string {
  switch (f.kind) {
    case "title": return `<title>${attr(f.after)}</title>`;
    case "meta": return `<meta name="description" content="${attr(f.after)}">`;
    case "h1": return `<h1>${attr(f.after)}</h1>`;
    case "canonical": return `<link rel="canonical" href="${attr(f.after)}">`;
    case "hreflang": return `<link rel="alternate" hreflang="${attr(f.target)}" href="${attr(f.after)}">`;
    case "alt": return `<img src="${attr(f.target)}" alt="${attr(f.after)}">`;
    case "link": return `<a href="${attr(f.after)}">`;
    case "jsonld": return `<script type="application/ld+json">\n${jsonScript(f.after)}\n</script>`;
    case "og":
      try {
        return Object.entries(JSON.parse(f.after) as Record<string, string>).map(([k, v]) => `<meta ${k.startsWith("twitter:") ? "name" : "property"}="${attr(k)}" content="${attr(String(v))}">`).join("\n");
      } catch {
        return "";
      }
    default: return f.after;
  }
}

export const KIND_LABEL: Record<string, string> = {
  title: "Título", meta: "Meta description", h1: "Encabezado H1", canonical: "Canonical", og: "Vista previa al compartir", jsonld: "Datos estructurados",
  alt: "Texto alternativo de imagen", hreflang: "Hreflang", link: "Link roto", redirect: "Redirección 301",
};

/** CSV de títulos y descripciones por URL (para importar en el CMS o pasarlo al equipo). */
export function metaCsv(fixes: FileFix[]): string {
  const by = new Map<string, { title?: FileFix; meta?: FileFix; h1?: FileFix }>();
  for (const f of fixes) if (f.url && (f.kind === "title" || f.kind === "meta" || f.kind === "h1")) by.set(f.url, { ...(by.get(f.url) ?? {}), [f.kind]: f });
  return csv([["url", "titulo_actual", "titulo_nuevo", "descripcion_actual", "descripcion_nueva", "h1_nuevo"], ...[...by].map(([url, v]) => [url, v.title?.before ?? "", v.title?.after ?? "", v.meta?.before ?? "", v.meta?.after ?? "", v.h1?.after ?? ""])]);
}

/** Instrucciones de implementación: una sección por página con el cambio exacto. Sirve para un programador o un asistente de código. */
export function implementationMd(o: { domain: string; fixes: FileFix[] }): string {
  const page = o.fixes.filter((f) => f.url);
  const site = o.fixes.filter((f) => !f.url);
  const by = new Map<string, FileFix[]>();
  for (const f of page) by.set(f.url, [...(by.get(f.url) ?? []), f]);
  const out: string[] = [
    `# Correcciones SEO aprobadas para ${o.domain}`, "",
    `${o.fixes.length} cambios concretos. Cada uno indica la página, el elemento, el valor actual y el valor nuevo exacto.`,
    "Aplica cada cambio en la plantilla o en el contenido que genera esa página (no con JavaScript en el navegador), sin modificar nada más.",
    "Si varias páginas comparten plantilla, corrige la plantilla para que el valor salga de los datos de cada página.", "",
  ];
  for (const [url, list] of by) {
    out.push(`## ${url}`, "");
    for (const f of list) {
      out.push(`### ${KIND_LABEL[f.kind] ?? f.kind}${f.kind === "alt" || f.kind === "jsonld" || f.kind === "hreflang" ? ` (${f.target})` : ""}`, "", `- Motivo: ${f.reason}`);
      if (f.before) out.push(`- Actual: \`${f.before.replace(/`/g, "'").slice(0, 300)}\``);
      out.push("- Nuevo:", "", "```html", fixHtml(f), "```", "");
    }
  }
  const links = site.filter((f) => f.kind === "link");
  if (links.length) {
    out.push("## Links internos rotos (en todas las páginas donde aparezcan)", "", "| href actual | href nuevo |", "| --- | --- |", ...links.map((f) => `| ${f.target} | ${f.after} |`), "");
  }
  const reds = redirectsOf(site);
  if (reds.length) {
    out.push("## Redirecciones 301 (en el servidor, no con JavaScript)", "", "| Desde | Hacia |", "| --- | --- |", ...reds.map((r) => `| ${pathOf(r.from)} | ${dest(r)} |`), "");
  }
  out.push("## Verificación", "", "Después de publicar: el HTML que entrega el servidor (ver código fuente, sin ejecutar JavaScript) debe traer los valores nuevos; cada URL redirigida debe responder 301 en un solo salto al destino indicado.", "");
  return out.join("\n");
}
