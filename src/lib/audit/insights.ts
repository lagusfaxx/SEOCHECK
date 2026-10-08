/**
 * Inteligencia de la auditoría: convierte cientos de issues sueltos en pocos hallazgos accionables.
 *
 * - Causa raíz: agrupa por plantilla (/products/*). Si afecta a la mayoría de la plantilla es un problema
 *   de plantilla: "corrige la plantilla una vez", no 76 URLs.
 * - Tipo: problema confirmado (algo no funciona) / posible problema (depende de la intención) / oportunidad.
 * - Prioridad por impacto, no solo severidad: cruza con Search Console (impresiones, posición), rankings
 *   trackeados y PageSpeed de la plantilla.
 * - Patrones: plantilla que concentra los problemas, tipo de página, CMS, issues que van juntos.
 *
 * Funciones puras (sin base de datos): las alimenta insights-data.ts y las usan la UI y el informe.
 */
import { ISSUE_LABELS } from "./issues";
import { ISSUE_FIX } from "./fixes";
import { CMS_FIX_HINT, CMS_LABEL, type Cms } from "./cms";
import { EASE, EASE_LABEL, isParamCanonical, PRIVATE_PATH, SEV_WEIGHT } from "../report-rules";
import { urlKey } from "../util";

export type Kind = "confirmed" | "possible" | "opportunity";
export type Priority = "alta" | "media" | "baja";

export const KIND_LABEL: Record<Kind, string> = { confirmed: "Problema confirmado", possible: "Posible problema", opportunity: "Oportunidad" };
export const KIND_HINT: Record<Kind, string> = {
  confirmed: "Error técnico verificable: algo no funciona como debería.",
  possible: "Puede ser un problema según lo que quieras para esas páginas: revísalo antes de cambiar.",
  opportunity: "Mejora recomendada, no un error: suma, pero el sitio funciona sin ella.",
};

/** Qué tan objetivo es cada issue. Las recomendaciones subjetivas no se presentan como errores. */
export const ISSUE_KIND: Record<string, Kind> = {
  http_4xx: "confirmed", http_5xx: "confirmed", fetch_failed: "confirmed", blocked_by_waf: "confirmed", broken_link: "confirmed",
  redirect_chain: "confirmed", noindex_in_sitemap: "confirmed", title_missing: "confirmed", jsonld_invalid: "confirmed",
  orphan: "possible", no_inlinks: "possible", dup_content: "possible", title_dup: "possible", meta_dup: "possible", canonical_other: "possible",
  blocked_robots: "possible", noindex: "possible", deep_page: "possible", slow: "possible", hreflang_no_self: "possible", redirect: "possible",
  thin_content: "possible", sitemap_missing: "possible", ssrf_blocked: "possible", h1_missing: "possible",
  title_long: "opportunity", title_short: "opportunity", meta_missing: "opportunity", meta_long: "opportunity", meta_short: "opportunity",
  h1_multiple: "opportunity", img_no_alt: "opportunity", canonical_missing: "opportunity", robots_missing: "opportunity",
};
export const kindOf = (code: string): Kind => ISSUE_KIND[code] ?? "possible";

/** Issues que dependen del title/H1/meta/contenido: mejorarlos ayuda a subir si la URL ya rankea cerca del top. */
const ONPAGE = new Set(["title_missing", "title_long", "title_short", "title_dup", "meta_missing", "meta_long", "meta_short", "meta_dup", "h1_missing", "h1_multiple", "thin_content", "dup_content"]);
/** Issues que no son de una URL sino del sitio entero. */
const SITE_WIDE = new Set(["robots_missing", "sitemap_missing"]);

// ---------- plantillas y tipos de página ----------

/** Agrupa por sección del sitio (/perfil/*) para ubicar la plantilla que genera la URL. */
export function urlSection(raw: string): string {
  try {
    const segs = new URL(raw).pathname.split("/").filter(Boolean);
    if (!segs.length) return "/";
    if (segs.length === 1) return `/${segs[0]}`;
    // segundo segmento fijo (/catalogue/category/…) vs. slug variable (/perfil/ana-123)
    const fixed = segs.length > 2 && !/\d/.test(segs[1]) && (segs[1].match(/-/g) ?? []).length < 2;
    return fixed ? `/${segs[0]}/${segs[1]}/*` : `/${segs[0]}/*`;
  } catch {
    return raw;
  }
}

export type PageKind = "home" | "product" | "category" | "article" | "page";
export const PAGE_KIND_LABEL: Record<PageKind, string> = { home: "home", product: "fichas de producto", category: "categorías / listados", article: "artículos / blog", page: "páginas" };

export function pageKind(url: string, jsonldTypes: string[] = [], depth = 1): PageKind {
  let path = "/";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    /* url rara: se clasifica como página */
  }
  if (depth === 0 || path === "/" || path === "") return "home";
  const t = jsonldTypes.map((x) => x.toLowerCase());
  if (t.includes("product") || /\/(products?|productos?|p|item|articulo-producto)\//.test(path)) return "product";
  if (t.some((x) => ["article", "blogposting", "newsarticle"].includes(x)) || /\/(blog|noticias|news|articulos?|posts?|guias?)\//.test(path)) return "article";
  if (t.some((x) => ["collectionpage", "itemlist", "offercatalog"].includes(x)) || /\/(collections?|categor(y|ia|ias|ies)|catalog(o|ue)?|tienda|shop|c)\//.test(path)) return "category";
  return "page";
}

// ---------- entrada ----------

export type PageIn = { url: string; status: number; depth: number; inlinks?: number; jsonldTypes?: string[]; error?: string | null; canonical?: string | null };
export type IssueIn = { url: string; code: string; severity: string; detail?: string | null };
export type Signals = {
  /** impresiones GSC 28 días por urlKey */
  impr?: Map<string, number>;
  /** posición media GSC por urlKey (ponderada por impresiones) */
  pos?: Map<string, number>;
  /** mejor ranking trackeado por urlKey */
  rank?: Map<string, { keyword: string; position: number }>;
  /** PageSpeed malo por plantilla: sección → descripción */
  psiBad?: Map<string, string>;
  cms?: Cms | null;
  /** el crawl tocó el máximo: las huérfanas no están confirmadas */
  hitLimit?: boolean;
};

export type Finding = {
  id: string;
  code: string;
  label: string;
  kind: Kind;
  severity: string;
  /** plantilla (/products/*), "todo el sitio" o "varias secciones" */
  template: string;
  scope: "template" | "site" | "layout" | "scattered" | "single";
  pageKind: PageKind | null;
  urls: string[];
  /** URLs leídas de esa plantilla */
  templateSize: number;
  share: number;
  /** problema de plantilla: corregir una vez arregla todas */
  rootCause: boolean;
  impressions: number | null;
  avgPosition: number | null;
  ranking: { keyword: string; position: number } | null;
  psi: string | null;
  ease: number;
  priority: Priority;
  points: number;
  /** por qué tiene esta prioridad */
  reasons: string[];
  /** conclusión en una frase */
  summary: string;
  fix: string;
};

export type Intentional = { code: string; count: number; text: string; examples: string[] };
export type Pattern = { kind: "template" | "pageKind" | "cms" | "together"; text: string };

const f0 = (n: number) => Math.round(n).toLocaleString("es-CL");
const f1 = (n: number) => n.toFixed(1).replace(".", ",");
const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${f0(n)} ${n === 1 ? one : many}`;
const pathOf = (u: string) => {
  try {
    return new URL(u).pathname + "/";
  } catch {
    return u;
  }
};

/** Separa lo que parece intencional (no es tarea) de lo real. */
export function splitIntentional(issues: IssueIn[], pages: PageIn[], s: Signals = {}) {
  const canonOf = new Map(pages.map((p) => [urlKey(p.url), p.canonical ?? null]));
  const paramCanon = issues.filter((i) => i.code === "canonical_other" && isParamCanonical(i.url, i.detail || canonOf.get(urlKey(i.url))));
  const privateBlocked = issues.filter((i) => i.code === "blocked_robots" && PRIVATE_PATH.test(pathOf(i.url)));
  const unverifiedOrphans = s.hitLimit ? issues.filter((i) => i.code === "orphan") : [];
  // carrito, login, cuenta, checkout: no compiten en Google, su title/H1/meta/canonical no importan
  const privateOnpage = issues.filter((i) => (ONPAGE.has(i.code) || i.code === "canonical_missing" || i.code === "img_no_alt") && PRIVATE_PATH.test(pathOf(i.url)));
  const skip = new Set([...paramCanon, ...privateBlocked, ...unverifiedOrphans, ...privateOnpage]);
  const intentional: Intentional[] = [];
  if (paramCanon.length) intentional.push({ code: "canonical_other", count: paramCanon.length, text: `Canonical a otra URL en ${plural(paramCanon.length, "URL")} con parámetros que apuntan a su versión sin parámetros (correcto)`, examples: paramCanon.slice(0, 3).map((i) => i.url) });
  if (privateBlocked.length) intentional.push({ code: "blocked_robots", count: privateBlocked.length, text: `Bloqueadas por robots ${plural(privateBlocked.length, "URL")} de login/cuenta/carrito/checkout (correcto)`, examples: privateBlocked.slice(0, 3).map((i) => i.url) });
  if (privateOnpage.length) {
    const urls = [...new Set(privateOnpage.map((i) => i.url))];
    intentional.push({ code: "private_onpage", count: privateOnpage.length, text: `${plural(privateOnpage.length, "detalle")} de title/H1/meta en ${plural(urls.length, "página")} de carrito/cuenta/login (no compiten en Google)`, examples: urls.slice(0, 3) });
  }
  return { real: issues.filter((i) => !skip.has(i)), intentional, unverifiedOrphans: unverifiedOrphans.length };
}

// ---------- hallazgos ----------

export function buildFindings(pagesIn: PageIn[], issuesIn: IssueIn[], s: Signals = {}): { findings: Finding[]; intentional: Intentional[]; patterns: Pattern[] } {
  const { real, intentional } = splitIntentional(issuesIn, pagesIn, s);
  const pages = pagesIn.filter((p) => p.status > 0 || p.error);
  const pageBy = new Map(pagesIn.map((p) => [urlKey(p.url), p]));
  const tplSize = new Map<string, number>();
  for (const p of pages) tplSize.set(urlSection(p.url), (tplSize.get(urlSection(p.url)) ?? 0) + 1);
  const hasGsc = Boolean(s.impr?.size);

  const byCode = new Map<string, IssueIn[]>();
  for (const i of real) byCode.set(i.code, [...(byCode.get(i.code) ?? []), i]);

  const findings: Finding[] = [];
  for (const [code, list] of byCode) {
    const urlsAll = [...new Set(list.map((i) => i.url))];
    const severity = list[0].severity;
    const make = (template: string, scope: Finding["scope"], urls: string[]) => findings.push(finding(code, severity, template, scope, urls, tplSize, pageBy, s, hasGsc));

    if (SITE_WIDE.has(code)) {
      make("todo el sitio", "site", urlsAll);
      continue;
    }
    const bySec = new Map<string, string[]>();
    for (const u of urlsAll) bySec.set(urlSection(u), [...(bySec.get(urlSection(u)) ?? []), u]);
    // layout común (header/footer/menú): afecta a la mayoría de las páginas de TODAS las secciones con contenido.
    // Si solo está en una plantilla (aunque sea casi todo el sitio, como los productos de una tienda), es esa plantilla.
    const bigSecs = [...tplSize.entries()].filter(([, n]) => n >= 3);
    if (urlsAll.length >= 10 && bigSecs.length >= 2 && bigSecs.every(([sec, n]) => (bySec.get(sec)?.length ?? 0) / n >= 0.6)) {
      make("todo el sitio", "layout", urlsAll);
      continue;
    }
    const loose: string[] = [];
    for (const [sec, urls] of bySec) {
      const size = tplSize.get(sec) ?? urls.length;
      const isTemplate = urls.length >= 3 && size >= 3 && urls.length / size >= 0.6;
      if (isTemplate || urls.length >= 5) make(sec, "template", urls);
      else loose.push(...urls);
    }
    // casos sueltos: un hallazgo por issue, no uno por sección (evita 40 tareas de 1 URL)
    if (loose.length) make(loose.length === 1 ? urlSection(loose[0]) : "varias secciones", loose.length === 1 ? "single" : "scattered", loose);
  }
  findings.sort((a, b) => b.points - a.points || (b.impressions ?? 0) - (a.impressions ?? 0) || b.urls.length - a.urls.length);
  return { findings, intentional, patterns: detectPatterns(pages, real, s.cms ?? null) };
}

function finding(code: string, severity: string, template: string, scope: Finding["scope"], urls: string[], tplSize: Map<string, number>, pageBy: Map<string, PageIn>, s: Signals, hasGsc: boolean): Finding {
  const kind = kindOf(code);
  const label = ISSUE_LABELS[code] ?? code;
  const size = scope === "template" ? tplSize.get(template) ?? urls.length : scope === "layout" ? [...tplSize.values()].reduce((a, b) => a + b, 0) : urls.length;
  const share = size ? urls.length / size : 1;
  const rootCause = scope === "layout" || (scope === "template" && urls.length >= 3 && share >= 0.6);
  const ease = EASE[code] ?? 0.8;

  // señales cruzadas
  let impressions: number | null = null;
  let posNum = 0, posDen = 0;
  let ranking: Finding["ranking"] = null;
  if (hasGsc && scope === "site") impressions = [...(s.impr?.values() ?? [])].reduce((a, b) => a + b, 0);
  else if (hasGsc) {
    impressions = 0;
    for (const u of urls) {
      const k = urlKey(u);
      const im = s.impr?.get(k) ?? 0;
      impressions += im;
      const ps = s.pos?.get(k);
      if (ps != null && im > 0) {
        posNum += ps * im;
        posDen += im;
      }
    }
  }
  for (const u of urls) {
    const r = s.rank?.get(urlKey(u));
    if (r && (!ranking || r.position < ranking.position)) ranking = r;
  }
  const avgPosition = posDen ? posNum / posDen : null;
  const sections = scope === "template" || scope === "single" ? [template] : [...new Set(urls.map(urlSection))];
  const psi = sections.map((sec) => s.psiBad?.get(sec)).find(Boolean) ?? null;
  const kinds = urls.map((u) => pageKind(u, pageBy.get(urlKey(u))?.jsonldTypes ?? [], pageBy.get(urlKey(u))?.depth ?? 1));
  const pk = kinds.length && kinds.every((k) => k === kinds[0]) ? kinds[0] : null;

  // ---- prioridad por impacto ----
  const reasons: string[] = [];
  let pts = (SEV_WEIGHT[severity] ?? 1) + (kind === "confirmed" ? 1 : kind === "opportunity" ? -0.5 : 0);
  reasons.push(
    scope === "site"
      ? "afecta a todo el sitio"
      : scope === "template" && rootCause
      ? `${plural(urls.length, "URL")} afectadas (${pct(share)} de ${template})`
      : scope === "layout"
        ? `${plural(urls.length, "URL")} afectadas (${pct(share)} del sitio)`
        : `${plural(urls.length, "URL")} afectada${urls.length === 1 ? "" : "s"}`
  );
  if (urls.length >= 20) pts += 1;
  else if (urls.length >= 5) pts += 0.5;
  if (rootCause) pts += 0.5;
  if (hasGsc && impressions != null) {
    // lo de todo el sitio no "multiplica" el tráfico: solo pesa si algo realmente no funciona
    if (scope === "site") pts += kind === "confirmed" && impressions > 0 ? 1 : 0;
    else if (impressions >= 1000) pts += 2;
    else if (impressions >= 100) pts += 1;
    else if (impressions === 0) pts -= 1;
    reasons.push(impressions ? `${f0(impressions)} impresiones/mes en Google${scope === "site" ? " (todo el sitio)" : ""}` : "sin impresiones en Google (28 días)");
    if (avgPosition != null) reasons.push(`posición media ${f1(avgPosition)}`);
  } else if (urls.some((u) => (pageBy.get(urlKey(u))?.depth ?? 1) === 0)) {
    pts += 1;
    reasons.push("incluye la home");
  }
  // 15. rankings: en posición 4–20 un title/H1 mejor puede subirla
  const nearTop = (ranking && ranking.position >= 4 && ranking.position <= 20) || (avgPosition != null && avgPosition >= 4 && avgPosition <= 20);
  if (ONPAGE.has(code) && nearTop) {
    pts += 1.5;
    reasons.push(ranking ? `«${ranking.keyword}» está en posición ${ranking.position}: mejorar title/H1 puede subirla` : `ya rankea en posición ${f1(avgPosition!)}: cerca de la primera página`);
  } else if (ranking) reasons.push(`rankea «${ranking.keyword}» en posición ${ranking.position}`);
  // 16. PageSpeed de la plantilla
  if (psi) {
    if (code === "slow") pts += 1.5;
    reasons.push(`PageSpeed: ${psi}`);
  }
  reasons.push(`arreglo: ${EASE_LABEL(ease)}${rootCause ? " (se corrige una vez en la plantilla)" : ""}`);
  const priority: Priority = pts >= 5 ? "alta" : pts >= 3 ? "media" : "baja";

  // ---- conclusión y cómo corregir ----
  const summary =
    scope === "site"
      ? `${label}: afecta a todo el sitio.`
      : scope === "layout"
        ? `Viene de la plantilla base del sitio (head, menú o footer): afecta ${f0(urls.length)} de ${f0(size)} URLs. Corrígelo una vez ahí.`
        : rootCause
          ? `Posible problema de plantilla ${template}: afecta ${f0(urls.length)} de ${f0(size)} URLs. Corrige la plantilla una vez.`
          : scope === "scattered"
            ? `${plural(urls.length, "URL")} sueltas en distintas secciones: revisar caso a caso.`
            : share >= 0.25 && urls.length >= 5
              ? `Afecta ${f0(urls.length)} de ${f0(size)} URLs de ${template}: revisa qué tienen en común${ONPAGE.has(code) ? " (suele ser un campo vacío o muy largo en esas fichas)" : ""}.`
              : `${plural(urls.length, "URL")} en ${template}: revisar caso a caso.`;
  const cmsHint = rootCause && s.cms && ONPAGE.has(code) ? ` ${CMS_FIX_HINT[s.cms]}` : "";
  return {
    id: `${code}|${template}`,
    code, label, kind, severity, template, scope, pageKind: pk, urls, templateSize: size, share, rootCause,
    impressions, avgPosition, ranking, psi, ease, priority, points: Math.round(pts * 10) / 10, reasons, summary,
    fix: (ISSUE_FIX[code] ?? "") + cmsHint,
  };
}

// ---------- patrones ----------

export function detectPatterns(pages: PageIn[], issues: IssueIn[], cms: Cms | null): Pattern[] {
  const out: Pattern[] = [];
  if (cms) out.push({ kind: "cms", text: `Sitio hecho con ${CMS_LABEL[cms]}: los títulos, metas y H1 repetidos se corrigen en la plantilla. ${CMS_FIX_HINT[cms]}` });
  const relevant = issues.filter((i) => !SITE_WIDE.has(i.code));
  if (relevant.length >= 10) {
    // plantilla que concentra los problemas
    const bySec = new Map<string, number>();
    for (const i of relevant) bySec.set(urlSection(i.url), (bySec.get(urlSection(i.url)) ?? 0) + 1);
    const [topSec, topN] = [...bySec.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topN / relevant.length >= 0.4 && bySec.size > 1) out.push({ kind: "template", text: `La plantilla ${topSec} concentra el ${pct(topN / relevant.length)} de los problemas (${f0(topN)} de ${f0(relevant.length)}): empieza por ahí.` });
    // tipo de página con más problemas por URL
    const kindOfUrl = new Map(pages.map((p) => [p.url, pageKind(p.url, p.jsonldTypes ?? [], p.depth)]));
    const perKind = new Map<PageKind, { pages: number; issues: number }>();
    for (const p of pages) {
      const k = kindOfUrl.get(p.url)!;
      perKind.set(k, { pages: (perKind.get(k)?.pages ?? 0) + 1, issues: perKind.get(k)?.issues ?? 0 });
    }
    for (const i of relevant) {
      const k = kindOfUrl.get(i.url);
      if (k && perKind.has(k)) perKind.get(k)!.issues++;
    }
    const kinds = [...perKind.entries()].filter(([k, v]) => v.pages >= 3 && k !== "home");
    if (kinds.length >= 2) {
      const ranked = kinds.map(([k, v]) => ({ k, avg: v.issues / v.pages, v })).sort((a, b) => b.avg - a.avg);
      const restPages = pages.length - ranked[0].v.pages;
      const restAvg = restPages ? (relevant.length - ranked[0].v.issues) / restPages : 0;
      if (ranked[0].avg >= 1 && ranked[0].avg >= restAvg * 1.5)
        out.push({ kind: "pageKind", text: `Las ${PAGE_KIND_LABEL[ranked[0].k]} tienen ${f1(ranked[0].avg)} problemas por URL en promedio (el resto del sitio ${f1(restAvg)}).` });
    }
  }
  // issues que aparecen juntos en las mismas URLs: probablemente el mismo origen
  const urlsBy = new Map<string, Set<string>>();
  for (const i of relevant) urlsBy.set(i.code, (urlsBy.get(i.code) ?? new Set()).add(i.url));
  const codes = [...urlsBy.entries()].filter(([, v]) => v.size >= 5).sort((a, b) => b[1].size - a[1].size).slice(0, 12);
  const seen = new Set<string>();
  for (let a = 0; a < codes.length; a++)
    for (let b = a + 1; b < codes.length; b++) {
      const [ca, A] = codes[a], [cb, B] = codes[b];
      let inter = 0;
      for (const u of A) if (B.has(u)) inter++;
      const jac = inter / (A.size + B.size - inter);
      if (jac >= 0.8 && !seen.has(ca) && !seen.has(cb)) {
        seen.add(ca).add(cb);
        out.push({ kind: "together", text: `«${ISSUE_LABELS[ca] ?? ca}» y «${ISSUE_LABELS[cb] ?? cb}» aparecen juntas en las mismas ${f0(inter)} URLs: probablemente tienen el mismo origen (la misma plantilla o el mismo campo vacío).` });
      }
    }
  return out.slice(0, 6);
}

/** Resumen por prioridad y tipo para la cabecera. */
export function summarize(findings: Finding[]) {
  const count = (f: (x: Finding) => boolean) => findings.filter(f).length;
  return {
    alta: count((x) => x.priority === "alta"),
    media: count((x) => x.priority === "media"),
    baja: count((x) => x.priority === "baja"),
    confirmed: count((x) => x.kind === "confirmed"),
    possible: count((x) => x.kind === "possible"),
    opportunity: count((x) => x.kind === "opportunity"),
    templates: count((x) => x.rootCause),
  };
}
