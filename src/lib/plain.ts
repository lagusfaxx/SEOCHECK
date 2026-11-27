/**
 * Explicaciones en lenguaje simple para quien no sabe de SEO:
 * - plainSummary: el estado del sitio en una frase, qué está bien, qué falta y el siguiente paso.
 * - checkPage: revisión instantánea de una página, con cada punto explicado y la corrección ya escrita.
 *
 * Solo se afirma lo que se midió. Lo que puede ser intencional (noindex en filtros, carrito bloqueado, canonical que
 * agrupa variantes) no se cuenta como problema; lo que no se midió se dice como "falta" y no como error.
 */
import { load } from "cheerio";
import { db } from "./db";
import { gscPeriod } from "./gsc-period";
import { kindOf, splitIntentional } from "./audit/insights";
import { ISSUE_LABELS, THIN_WORDS, UTILITY_PAGE } from "./audit/issues";
import { fetchPage } from "./audit/crawler";
import { parseRobots, robotsAllows } from "./audit/robots";
import { safeFetch } from "./net/ssrf";
import { serpWidthPx, TITLE_MAX_PX, META_MAX_PX } from "./report-rules";
import { generateFixes, type FixPage, type Proposal } from "./fixes/generate";
import { brandOf } from "./content/clean";
import { fixHtml } from "./fixes/files";

export type Tone = "good" | "warn" | "bad" | "info";
export type Line = { tone: Tone; title: string; text: string; href?: string; cta?: string };

/** Problemas que de verdad bloquean visitas o la indexación: lo que un dueño de sitio tiene que saber primero. */
const BLOCKING = new Set(["http_4xx", "http_5xx", "fetch_failed", "blocked_by_waf", "broken_link", "redirect_loop", "canonical_loop", "robots_conflict", "noindex_in_sitemap", "canonical_bad_target", "client_redirect", "soft_404"]);

const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
const n = (x: number) => x.toLocaleString("es-CL");
const plural = (x: number, one: string, many: string) => `${n(x)} ${x === 1 ? one : many}`;

export async function plainSummary(projectId: string) {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { domain: true, gscProperty: true, settings: true } });
  const crawl = await db.crawl.findFirst({ where: { projectId, private: false, status: { in: ["completed", "partial"] } }, orderBy: { startedAt: "desc" } });
  const lines: Line[] = [];
  const good: string[] = [];
  const base = `/p/${projectId}`;
  if (!crawl) {
    return {
      verdict: "info" as Tone,
      headline: "Aún no revisamos tu sitio",
      sub: "El primer análisis tarda unos minutos y te dice qué está bien, qué falta y qué cambios hacer, ya escritos.",
      next: { label: "Analizar mi sitio", href: `${base}/audit` },
      lines,
      good,
      at: null,
    };
  }
  const [issues, pages, fixes, live, cms] = await Promise.all([
    db.issue.findMany({ where: { crawlId: crawl.id }, select: { url: true, code: true, severity: true, detail: true } }),
    db.page.findMany({ where: { crawlId: crawl.id }, select: { url: true, status: true, noindex: true, canonical: true, canonicalType: true, blocked: true, error: true, inSitemap: true, title: true, template: true, inlinks: true } }),
    db.fix.groupBy({ by: ["status"], where: { projectId }, _count: true }),
    db.liveSite.findUnique({ where: { projectId } }),
    db.cmsConnection.findUnique({ where: { projectId }, select: { kind: true, status: true } }),
  ]);
  const stats = (crawl.stats ?? {}) as Record<string, any>;
  const { real } = splitIntentional(issues, pages as any, { hitLimit: Boolean(stats.limitReached) });
  const ok = pages.filter((p) => p.status === 200 && !p.error && !p.blocked);
  const blocking = real.filter((i) => BLOCKING.has(i.code));
  const blockingUrls = new Set(blocking.map((i) => i.url));
  const warnings = real.filter((i) => !BLOCKING.has(i.code) && i.severity !== "info" && kindOf(i.code) !== "opportunity");
  const fixCount = (s: string) => fixes.find((f) => f.status === s)?._count ?? 0;
  const proposed = fixCount("proposed"), approved = fixCount("approved"), verified = fixCount("verified");
  const publishing = Boolean((live?.lastSeenAt && Date.now() - +live.lastSeenAt < 14 * 864e5 && live.enabled) || cms?.status === "connected");

  // ── qué está bien (solo lo comprobado) ──
  if (ok.length && !pages.some((p) => p.status >= 500 || p.error === "fetch_failed")) good.push(`Las ${n(ok.length)} páginas revisadas cargan bien`);
  if (crawl.sitemapUrls > 0) good.push(`Tu sitio le dice a Google qué páginas tiene (sitemap con ${n(crawl.sitemapUrls)} direcciones)`);
  if (crawl.robots && !real.some((i) => i.code === "robots_missing")) good.push("Google puede entrar a tu sitio (robots.txt correcto)");
  if (!real.some((i) => i.code === "title_missing" || i.code === "title_dup")) good.push("Cada página tiene su propio título en Google");
  if (!real.some((i) => i.code === "broken_link")) good.push("No encontramos links rotos");
  if (!real.some((i) => ["jsonld_invalid", "jsonld_mismatch"].includes(i.code)) && pages.some((p) => p.template === "product")) good.push("Los datos de tus productos coinciden con lo que se ve en la página");

  // ── lo que importa ──
  if (blocking.length) {
    const label = ISSUE_LABELS[blocking[0].code] ?? blocking[0].code;
    lines.push({ tone: "bad", title: `${plural(blockingUrls.size, "página tiene", "páginas tienen")} un error que frena visitas`, text: `Por ejemplo: ${label.toLowerCase()}. Una persona o Google que llega ahí no ve el contenido.`, href: `${base}/tasks`, cta: "Ver cuáles" });
  }
  if (warnings.length) lines.push({ tone: "warn", title: `${plural(new Set(warnings.map((w) => w.code)).size, "detalle técnico", "detalles técnicos")} por revisar`, text: "No impiden las visitas, pero pueden hacer que Google muestre menos tus páginas. Cada uno trae cómo comprobarlo.", href: `${base}/tasks`, cta: "Revisar" });

  if (proposed) lines.push({ tone: "info", title: `${plural(proposed, "mejora ya escrita", "mejoras ya escritas")} para tu sitio`, text: "Títulos, descripciones y datos para Google listos para aprobar. Tú decides cuáles publicar.", href: `${base}/fixes`, cta: "Revisarlas" });
  if (approved && !publishing) lines.push({ tone: "warn", title: `${plural(approved, "mejora aprobada no está", "mejoras aprobadas no están")} en tu sitio todavía`, text: "Conecta tu WordPress o Shopify, o pega una línea de código, para que se publiquen solas.", href: `${base}/fixes?status=publish`, cta: "Publicar" });
  if (approved && publishing) good.push(`${plural(approved, "mejora publicada", "mejoras publicadas")} en tu sitio`);
  if (verified) good.push(`${plural(verified, "mejora confirmada", "mejoras confirmadas")} en el código de tu sitio`);

  // ── Google (Search Console) ──
  const period = await gscPeriod(projectId).catch(() => null);
  if (period) {
    const [cur, prev] = await Promise.all([
      db.gscDay.aggregate({ where: { projectId, date: { gte: period.start, lte: period.end } }, _sum: { clicks: true, impressions: true } }),
      db.gscDay.aggregate({ where: { projectId, date: { gte: period.prevStart, lt: period.start } }, _sum: { clicks: true, impressions: true } }),
    ]);
    const c = cur._sum.clicks ?? 0, p = prev._sum.clicks ?? 0, d = pct(c, p);
    // con poca base el porcentaje engaña: se dice el número y no la variación
    const trend = d == null || p < 30 ? "" : d >= 10 ? `, ${d}% más que el mes anterior` : d <= -10 ? `, ${Math.abs(d)}% menos que el mes anterior` : ", parecido al mes anterior";
    lines.push({ tone: d != null && p >= 30 && d <= -20 ? "warn" : "good", title: `${plural(c, "visita", "visitas")} desde Google en 28 días${trend}`, text: `Tu sitio apareció ${n(cur._sum.impressions ?? 0)} veces en resultados de búsqueda.`, href: `${base}/gsc`, cta: "Ver búsquedas" });
  } else {
    lines.push({ tone: "info", title: "Falta conectar tus datos de Google", text: "Con Search Console vemos qué buscan para llegar a ti y priorizamos con visitas reales. Toma 2 minutos.", href: `${base}/settings`, cta: "Conectar" });
  }

  const verdict: Tone = blocking.length ? "bad" : warnings.length || (approved && !publishing) ? "warn" : "good";
  const headline =
    verdict === "bad" ? `Hay ${plural(blockingUrls.size, "página con un error", "páginas con errores")} que conviene arreglar primero`
    : verdict === "warn" ? "Tu sitio funciona bien, con detalles por mejorar"
    : "Tu sitio está en buen estado técnico";
  const sub =
    verdict === "good"
      ? proposed ? "Lo que queda son mejoras para atraer más visitas desde Google, no errores." : "No encontramos errores. Sigue con contenido: es lo que más mueve las visitas ahora."
      : `Revisamos ${plural(pages.length, "página", "páginas")}. Lo intencional (filtros con noindex, carrito bloqueado, variantes de producto) no se cuenta como problema.`;
  const next =
    blocking.length ? { label: "Ver los errores", href: `${base}/tasks` }
    : proposed ? { label: `Revisar ${plural(proposed, "mejora", "mejoras")}`, href: `${base}/fixes` }
    : approved && !publishing ? { label: "Publicar mejoras", href: `${base}/fixes?status=publish` }
    : !period ? { label: "Conectar Google", href: `${base}/settings` }
    : { label: "Escribir un artículo", href: `${base}/articles` };
  return { verdict, headline, sub, next, lines, good: good.slice(0, 6), at: crawl.finishedAt ?? crawl.startedAt };
}

// ── Revisar una página ──────────────────────────────────────────────────────────

export type Check = { id: string; tone: Tone; title: string; text: string; detail?: string };

export async function checkPage(projectId: string, url: string) {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { domain: true, name: true, language: true, settings: true } });
  const t0 = Date.now();
  const p = await fetchPage(url);
  const checks: Check[] = [];
  const html = p.evidence?.responseHtml ?? "";
  const $ = html ? load(html) : null;
  const finalPath = (() => {
    try {
      return new URL(p.finalUrl).pathname;
    } catch {
      return "/";
    }
  })();

  // 1. responde
  if (p.error || p.status === 0) checks.push({ id: "status", tone: "bad", title: "La página no respondió", text: "Ni las personas ni Google pueden verla. Revisa que el servidor esté en línea.", detail: p.error });
  else if (p.status >= 400) checks.push({ id: "status", tone: "bad", title: `La página da error ${p.status}`, text: p.status === 404 ? "No existe. Si antes existía, conviene redirigirla (301) a la página que la reemplaza." : "El servidor responde con error: Google deja de mostrarla si se repite." });
  else if (p.redirects.length > 1) checks.push({ id: "status", tone: "warn", title: `Redirige ${p.redirects.length} veces antes de cargar`, text: "Cada salto la hace más lenta. Lo ideal es una sola redirección directa al destino." });
  else checks.push({ id: "status", tone: "good", title: p.redirects.length ? "Redirige bien a su versión final" : "La página carga bien", text: `Respondió en ${n(p.responseMs)} ms${p.redirects.length ? ` y lleva a ${finalPath}` : ""}.` });
  const live = p.status === 200 && !p.error;

  // 2. Google puede mostrarla
  if (live) {
    let blockedByRobots = false;
    try {
      const r = await safeFetch(new URL("/robots.txt", p.finalUrl).toString(), { timeoutMs: 8000 });
      if (r.res.ok) blockedByRobots = !robotsAllows(parseRobots(await r.res.text()), p.finalUrl);
      else await r.res.body?.cancel().catch(() => {});
    } catch {}
    if (blockedByRobots) checks.push({ id: "index", tone: UTILITY_PAGE.test(p.finalUrl) ? "info" : "bad", title: "Google tiene prohibido entrar a esta página", text: UTILITY_PAGE.test(p.finalUrl) ? "El robots.txt la bloquea. En una página de cuenta, carrito o pago es lo correcto." : "El robots.txt la bloquea. Si debe aparecer en Google, quita esa regla." });
    else if (p.noindex) checks.push({ id: "index", tone: "warn", title: "La página pide no aparecer en Google (noindex)", text: "Está bien en filtros, búsquedas o páginas privadas. Si quieres que aparezca, quita el noindex." });
    else if (p.canonicalType === "other") checks.push({ id: "index", tone: "info", title: "Le dice a Google que la versión principal es otra", text: `Google mostrará ${p.canonical} en su lugar. Es lo correcto si esta página es una variante (color, talla, filtro).` });
    else checks.push({ id: "index", tone: "good", title: "Google puede mostrarla en sus resultados", text: "No está bloqueada ni pide quedar fuera de Google." });
  }

  // 3. título y descripción (lo que la gente lee en Google)
  const codes: string[] = [];
  if (live) {
    const tw = p.title ? serpWidthPx(p.title, 20) : 0;
    if (!p.title) codes.push("title_missing");
    else if (tw > TITLE_MAX_PX) codes.push("title_long");
    else if (p.title.length < 25) codes.push("title_short");
    if (!p.metaDesc) codes.push("meta_missing");
    else if (p.metaDesc && serpWidthPx(p.metaDesc, 14) > META_MAX_PX) codes.push("meta_long");
    else if (p.metaDesc.length < 70) codes.push("meta_short");
    if (!p.h1.length) codes.push("h1_missing");
    if (!p.canonical) codes.push("canonical_missing");
    if (!p.title) checks.push({ id: "title", tone: "bad", title: "No tiene título", text: "Es el texto azul que se ve en Google. Sin él, Google inventa uno." });
    else if (tw > TITLE_MAX_PX) checks.push({ id: "title", tone: "warn", title: "El título se corta en Google", text: "Lo importante debería ir al inicio. Te proponemos una versión que cabe completa.", detail: p.title });
    else if (p.title.length < 25) checks.push({ id: "title", tone: "warn", title: "El título es muy corto", text: "No alcanza a decir qué ofrece la página.", detail: p.title });
    else checks.push({ id: "title", tone: "good", title: "Buen título", text: "Se lee completo en Google.", detail: p.title });
    const mw = p.metaDesc ? serpWidthPx(p.metaDesc, 14) : 0;
    if (!p.metaDesc) checks.push({ id: "meta", tone: "warn", title: "No tiene descripción para Google", text: "Es el texto gris bajo el título. Una buena descripción hace que más gente haga clic." });
    else if (mw > META_MAX_PX) checks.push({ id: "meta", tone: "info", title: "La descripción se corta", text: "No es un error: Google muestra el comienzo. Te proponemos una que termina en una frase completa.", detail: p.metaDesc });
    else if (p.metaDesc.length < 70) checks.push({ id: "meta", tone: "info", title: "La descripción es corta", text: "Puedes aprovechar mejor el espacio para convencer el clic.", detail: p.metaDesc });
    else checks.push({ id: "meta", tone: "good", title: "Buena descripción", text: "Resume la página y cabe en Google.", detail: p.metaDesc });

    // 4. estructura y contenido
    if (!p.h1.length) checks.push({ id: "h1", tone: "warn", title: "Le falta el encabezado principal (H1)", text: "Es el título grande dentro de la página: le dice a Google y al visitante de qué trata." });
    else if (p.h1.length > 1) checks.push({ id: "h1", tone: "info", title: `Tiene ${p.h1.length} encabezados principales`, text: "Lo normal es uno solo. No es grave." });
    else checks.push({ id: "h1", tone: "good", title: "Encabezado principal claro", text: p.h1[0] });
    if (!UTILITY_PAGE.test(p.finalUrl)) {
      if (p.wordCount < THIN_WORDS) checks.push({ id: "words", tone: "info", title: `Tiene poco texto (${n(p.wordCount)} palabras)`, text: "Solo importa si quieres que aparezca en búsquedas: en ese caso, agrega información útil (no relleno)." });
      else checks.push({ id: "words", tone: "good", title: `Tiene contenido (${n(p.wordCount)} palabras)`, text: "Hay texto suficiente para que Google entienda la página." });
    }
    const imgs = p.parsedExtra?.images ?? [];
    const noAlt = imgs.filter((i) => i.alt == null && i.src && !/^data:/.test(i.src)).length;
    if (imgs.length) checks.push(noAlt ? { id: "alt", tone: "info", title: `${plural(noAlt, "imagen no tiene", "imágenes no tienen")} descripción`, text: "Google Imágenes y las personas con lector de pantalla no saben qué muestran. Te las proponemos escritas." } : { id: "alt", tone: "good", title: "Las imágenes tienen descripción", text: `${plural(imgs.length, "imagen", "imágenes")} con texto alternativo.` });

    // 5. extras que se notan en Google y al compartir
    const schema = p.schemaIssues ?? [];
    if (schema.length) checks.push({ id: "schema", tone: "warn", title: "Los datos para Google no coinciden con la página", text: "Google puede quitar estrellas, precio o preguntas de tu resultado si no coinciden con lo visible.", detail: schema[0] });
    else if (p.jsonldTypes.length) checks.push({ id: "schema", tone: "good", title: "Tiene datos para resultados enriquecidos", text: `Declara: ${[...new Set(p.jsonldTypes)].slice(0, 5).join(", ")}.` });
    else checks.push({ id: "schema", tone: "info", title: "No tiene datos para resultados enriquecidos", text: "Con ellos Google puede mostrar precio, stock, preguntas o el logo junto a tu resultado." });
    const og = $?.('meta[property="og:title"]').attr("content");
    const ogImg = $?.('meta[property="og:image"]').attr("content");
    checks.push(og && ogImg ? { id: "og", tone: "good", title: "Se ve bien al compartirla", text: "En WhatsApp, Facebook o LinkedIn sale con título e imagen." } : { id: "og", tone: "info", title: "Al compartirla sale sin imagen o título propio", text: "En WhatsApp y redes se ve pobre. Te proponemos las etiquetas." });
    const viewport = $?.('meta[name="viewport"]').attr("content");
    checks.push(viewport ? { id: "mobile", tone: "good", title: "Preparada para celulares", text: "Se adapta al ancho de la pantalla." } : { id: "mobile", tone: "bad", title: "No está preparada para celulares", text: "Le falta la etiqueta viewport: en el celular se ve chica y Google la posiciona peor." });
    checks.push(p.finalUrl.startsWith("https://") ? { id: "https", tone: "good", title: "Conexión segura (HTTPS)", text: "El navegador no muestra advertencias." } : { id: "https", tone: "bad", title: "Sin conexión segura", text: "El navegador la marca como «no segura». Activa HTTPS en tu hosting." });
    checks.push(p.responseMs < 800 ? { id: "speed", tone: "good", title: "El servidor responde rápido", text: `${n(p.responseMs)} ms.` } : p.responseMs < 1800 ? { id: "speed", tone: "info", title: "El servidor responde algo lento", text: `${n(p.responseMs)} ms. Lo ideal es menos de 800 ms.` } : { id: "speed", tone: "warn", title: "El servidor responde lento", text: `${n(p.responseMs)} ms. Revisa caché o hosting: afecta visitas y rastreo.` });
  }

  // correcciones ya escritas para esta página (las mismas reglas que Correcciones)
  let proposals: (Proposal & { html: string })[] = [];
  if (live) {
    const issues = codes.map((code) => ({ url: p.url, code }));
    const fp: FixPage = { url: p.url, finalUrl: p.finalUrl, status: p.status, redirects: p.redirects, title: p.title, metaDesc: p.metaDesc, h1: p.h1, canonical: p.canonical, canonicalType: p.canonicalType, noindex: p.noindex, template: p.parsedExtra?.template ?? null, jsonldTypes: p.jsonldTypes, hreflang: p.hreflang, images: p.parsedExtra?.images ?? [], links: p.links, commerce: p.parsedExtra?.commerce ?? {}, inSitemap: true, inlinks: 1, responseHtml: html };
    proposals = generateFixes([fp], { domain: project.domain, brand: brandOf(project), language: project.language, issues }).map((x) => ({ ...x, html: fixHtml(x) }));
  }
  const counts = { bad: checks.filter((c) => c.tone === "bad").length, warn: checks.filter((c) => c.tone === "warn").length, good: checks.filter((c) => c.tone === "good").length };
  return {
    url: p.url,
    finalUrl: p.finalUrl,
    status: p.status,
    title: p.title,
    metaDesc: p.metaDesc,
    verdict: (counts.bad ? "bad" : counts.warn ? "warn" : "good") as Tone,
    headline: counts.bad ? `${plural(counts.bad, "problema importante", "problemas importantes")} en esta página` : counts.warn ? `Bien, con ${plural(counts.warn, "detalle", "detalles")} por mejorar` : "Esta página está bien para Google",
    counts,
    checks,
    proposals,
    ms: Date.now() - t0,
  };
}
