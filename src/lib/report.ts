import { adviceReport } from "./advice/service";
import { fieldCls } from "./web-vitals";
import { db } from "./db";
import { env } from "./env";
import { detailText, ISSUE_LABELS } from "./audit/issues";
import { DEFAULT_VERIFY, ISSUE_VERIFY } from "./audit/fixes";
import { gscPeriod, isoDay, periodLabel, SOURCE_NOTE } from "./gsc-period";
import { marketingOverview } from "./marketing";
import { backlinksOverview } from "./backlinks";
import { FIELD_LABEL, latestCrawlChanges } from "./watch";
import { aiLocalOverview } from "./ai-local";
import { gapOverview } from "./keyword-gap";
import { ownEvidence } from "./content/analyze";
import { verifyBrief } from "./content/claims";
import { hostOf, urlKey } from "./util";
import { coverage, emptyText, STATE_LABEL } from "./coverage";
import { buildFindings, KIND_LABEL, kindOf, urlSection, type Pattern } from "./audit/insights";
import type { Cms } from "./audit/cms";
import { RULES_VERSION, brandFromDomain, CONFIDENCE_FACTOR, DISCREPANCY_HINT, EASE_LABEL, expectedCtrAt, isBrandQuery, ISSUE_RISK, makeTask, MINOR_FACTOR, psiVerdict, SEV_WEIGHT, byPriority, MINOR_ONPAGE, LOW_GSC_IMPRESSIONS, MIN_TREND_BASE, spellingVariants, type Confidence, type PsiField, type Task } from "./report-rules";

const SEV_ORDER = ["critical", "warning", "info"] as const;
const SEV_LABEL: Record<string, string> = { critical: "Error", warning: "Advertencia", info: "Observación" };
const MAX_URLS = 25;

export { urlSection };

function topSections(urls: string[], n = 4) {
  const m = new Map<string, number>();
  for (const u of urls) m.set(urlSection(u), (m.get(urlSection(u)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

const f0 = (n: number | null | undefined) => (n == null ? "–" : Math.round(n).toLocaleString("es-CL"));
const f1 = (n: number | null | undefined) => (n == null ? "–" : n.toFixed(1));
const pctS = (n: number | null | undefined) => (n == null ? "–" : `${(n * 100).toFixed(1)}%`);
const date = (d: Date | null | undefined) => (d ? d.toLocaleString("es-CL", { timeZone: env.tz, dateStyle: "short", timeStyle: "short" }) : "–");
const cell = (s: unknown) => String(s ?? "–").replace(/\|/g, "\\|").replace(/\n/g, " ");
const table = (head: string[], rows: unknown[][]) =>
  rows.length ? [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n") : "_sin datos_";

const pctChange = (now: number, before: number) =>
  !before ? "sin período anterior" : before < MIN_TREND_BASE ? `antes ${before}` : `${now >= before ? "+" : ""}${(((now - before) / before) * 100).toFixed(1).replace(".", ",")} %`;
const MAX_TASKS = 30;
const pl = (n: number, one: string, many = `${one}s`) => `${f0(n)} ${n === 1 ? one : many}`;

/** Genera el informe completo del proyecto en Markdown, a partir de lo último guardado de cada módulo. */
export async function buildReport(projectId: string): Promise<string> {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const site = p.domain;
  const siteHost = hostOf(`https://${site}`);
  const mine = (u: string) => hostOf(u) === siteHost || hostOf(u).endsWith(`.${siteHost}`);
  const brand = brandFromDomain(site);
  const cov = await coverage(projectId);
  const mod = (k: string) => cov.find((m) => m.key === k);
  const tasks: Task[] = [];
  /** chequeos de consistencia del propio informe: [qué se comprobó, ok, detalle si falla] */
  const checks: [string, boolean, string?][] = [];
  let httpCounts: { c4xx: number; c5xx: number } | null = null;
  const notes: string[] = [];
  const intentional: string[] = [];
  const trends: string[] = [];
  const patterns: Pattern[] = [];

  // ---------- Tráfico por URL (GSC 28 días) y peso de plantilla (sin GSC) ----------
  // un solo período para todo el informe (y el mismo que usa el PDF): 28 días hasta el último día con datos
  const period = await gscPeriod(projectId);
  const gscEnd = period?.end ?? null;
  const d28 = period?.start ?? null;
  const end1 = period?.endExclusive ?? null;
  const imprByUrl = new Map<string, number>();
  let siteImpr = 0;
  if (d28 && end1) {
    const byPage = await db.gscRow.groupBy({ by: ["page"], where: { projectId, date: { gte: d28, lt: end1 } }, _sum: { impressions: true } });
    for (const r of byPage) {
      const k = urlKey(r.page);
      imprByUrl.set(k, (imprByUrl.get(k) ?? 0) + (r._sum.impressions ?? 0));
      siteImpr += r._sum.impressions ?? 0;
    }
  }
  // con muy pocas impresiones el tráfico no ordena nada: se usa el peso de cada URL en el sitio
  const hasGsc = imprByUrl.size > 0 && siteImpr >= LOW_GSC_IMPRESSIONS;
  const crawl = await db.crawl.findFirst({ where: { projectId, status: { in: ["completed", "partial"] } }, orderBy: { startedAt: "desc" } });
  const pages = crawl ? await db.page.findMany({ where: { crawlId: crawl.id }, select: { url: true, inlinks: true, outlinks: true, depth: true, status: true, canonical: true, inSitemap: true, blocked: true, error: true, noindex: true, redirects: true, finalUrl: true } }) : [];
  const pageByKey = new Map(pages.map((x) => [urlKey(x.url), x]));
  const weight = (u: string) => {
    const pg = pageByKey.get(urlKey(u));
    return 1 + Math.log2(1 + (pg?.inlinks ?? 0)) + (pg?.depth === 0 ? 3 : 0);
  };
  /** tráfico afectado: impresiones GSC (+1 por URL para desempatar) o, sin GSC, el peso de las URLs en el sitio */
  const trafficOf = (urls: string[]) => {
    if (hasGsc) {
      const v = urls.reduce((s, u) => s + (imprByUrl.get(urlKey(u)) ?? 0) + 1, 0);
      return { traffic: v, label: `${f0(v)} impr` };
    }
    const v = Math.round(urls.reduce((s, u) => s + weight(u), 0) * 10) / 10;
    return { traffic: v, label: `peso ${f1(v)} (${imprByUrl.size ? "pocas impresiones GSC" : "sin GSC"}: links entrantes y home)` };
  };
  /**
   * Mejoras cosméticas: el tráfico NO se suma por cada variante (100 fichas por color con el mismo aviso no valen
   * 100 veces más). Cuenta la URL con más tráfico y crece apenas con la cantidad.
   */
  const trafficMinor = (urls: string[]) => {
    const per = urls.map((u) => (hasGsc ? (imprByUrl.get(urlKey(u)) ?? 0) + 1 : weight(u)));
    const v = Math.round(Math.max(0, ...per) * (1 + Math.log2(Math.max(1, urls.length))) * 10) / 10;
    return { traffic: v, label: `${hasGsc ? `${f0(Math.max(0, ...per))} impr` : `peso ${f1(Math.max(0, ...per))}`} (URL principal) × ${f1(1 + Math.log2(Math.max(1, urls.length)))} por ${urls.length} URLs` };
  };
  /** tráfico de toda una plantilla (sección) */
  const sectionTraffic = (section: string) => trafficOf(pages.filter((x) => urlSection(x.url) === section).map((x) => x.url).concat(hasGsc ? [...imprByUrl.keys()].filter((k) => urlSection(`https://${k}`) === section && !pageByKey.has(k)).map((k) => `https://${k}`) : []));
  const siteTraffic = () => (hasGsc ? { traffic: siteImpr, label: `${f0(siteImpr)} impr (todo el sitio)` } : trafficOf(pages.map((x) => x.url)));

  // ---------- Tendencias ----------
  let gscImpr28: number | null = null;
  if (period && gscEnd && d28 && end1) {
    const d56 = period.prevStart;
    const hasDays = Boolean(await db.gscDay.findFirst({ where: { projectId } }));
    const agg = async (gte: Date, lt: Date) => {
      if (hasDays) {
        const rows = await db.gscDay.findMany({ where: { projectId, date: { gte, lt } } });
        const c = rows.reduce((s, r) => s + r.clicks, 0), i = rows.reduce((s, r) => s + r.impressions, 0);
        return { c, i, pos: i ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / i : null };
      }
      const r = await db.gscRow.aggregate({ where: { projectId, date: { gte, lt } }, _sum: { clicks: true, impressions: true } });
      return { c: r._sum.clicks ?? 0, i: r._sum.impressions ?? 0, pos: null as number | null };
    };
    const [cur, prev] = await Promise.all([agg(d28, end1), agg(d56, d28)]);
    gscImpr28 = cur.i;
    trends.push(
      `_Período: ${periodLabel(period, hasDays ? "totals" : "rows")}. Comparado con ${isoDay(d56)} a ${isoDay(new Date(d28.getTime() - 864e5))}._`,
      "",
      `- **Clics:** ${f0(cur.c)} (${pctChange(cur.c, prev.c)})`,
      `- **Impresiones:** ${f0(cur.i)} (${pctChange(cur.i, prev.i)})`,
      `- **CTR:** ${pctS(cur.i ? cur.c / cur.i : null)} (antes ${pctS(prev.i ? prev.c / prev.i : null)})`,
      ...(cur.pos != null && prev.pos != null ? [`- **Posición media:** ${f1(cur.pos)} (antes ${f1(prev.pos)})`] : []),
      "",
      `_${[hasDays ? SOURCE_NOTE : "", prev.c < MIN_TREND_BASE || prev.i < MIN_TREND_BASE ? `Con menos de ${MIN_TREND_BASE} en el período anterior se muestra el valor absoluto: un porcentaje sobre una base tan chica exagera el cambio.` : ""].filter(Boolean).join(" ") || "Mismo período y fuente en todo el informe."}_`
    );
    if (cur.i < LOW_GSC_IMPRESSIONS)
      notes.push(`Pocos datos de Search Console: ${f0(cur.i)} impresiones en 28 días. Las tendencias son orientativas y el orden de las tareas no usa impresiones: se basa en severidad, evidencia, facilidad y peso de cada URL en el sitio.`);
  }

  // ---------- Auditoría ----------
  const auditOut: string[] = [];
  const appendix: string[] = [];
  const httpOut: string[] = [];
  if (crawl) {
    const st = crawl.stats as Record<string, any>;
    const opts = crawl.options as Record<string, any>;
    const issues = await db.issue.findMany({ where: { crawlId: crawl.id }, orderBy: { url: "asc" } });
    const viaLinks = (st.pages ?? 0) - Math.min(st.orphans ?? 0, 300);
    const hitLimit = st.limitReached ?? Boolean(opts.maxPages && viaLinks >= opts.maxPages);
    const orphanUrls = issues.filter((i) => i.code === "orphan").map((i) => i.url);
    const unverified = st.sitemapNotReached ?? orphanUrls.length;
    if (hitLimit && unverified)
      notes.push(`El crawl llegó al límite de ${opts.maxPages} páginas: ${pl(unverified, "URL")} del sitemap no se alcanzaron a recorrer, así que no se puede saber si tienen links. No se generan tareas sobre eso; repetir con un máximo mayor.`);
    // menú/footer armado con JavaScript: páginas de primer nivel sin link encontrado o una home casi sin links en el HTML
    const home = pages.find((x) => x.depth === 0 && x.status === 200);
    const topLevelOrphans = orphanUrls.filter((u) => {
      try {
        return new URL(u).pathname.split("/").filter(Boolean).length === 1;
      } catch {
        return false;
      }
    });
    if (topLevelOrphans.length >= 3 || (home && home.outlinks < 10 && (st.sitemap ?? 0) > 20))
      notes.push(
        `Páginas que normalmente se enlazan desde el menú o el footer aparecen sin link${topLevelOrphans.length ? ` (${topLevelOrphans.slice(0, 4).map((u) => `\`${new URL(u).pathname}\``).join(", ")}…)` : ""}${home && home.outlinks < 10 ? ` y la home tiene solo ${home.outlinks} links en el HTML` : ""}: probablemente el menú se arma con JavaScript. Repetir el crawl con **render JS** activado para confirmarlo.`
      );
    if (!opts.render)
      notes.push("El crawl leyó el HTML inicial, sin ejecutar JavaScript. Los links y textos que se agregan en el navegador (o solo bajo ciertas condiciones de datos) no se ven: «sin link encontrado», «sin H1» y «poco texto» son hipótesis hasta comprobarlas en el código o con render JS.");
    if (st.wafAborted) notes.push("El crawl se cortó porque el WAF bloqueó demasiadas páginas seguidas.");

    // conteos HTTP desde los mismos issues que la tabla de abajo: los números siempre cuadran entre secciones
    const byIssue = (code: string) => issues.filter((i) => i.code === code);
    const http = { c4xx: byIssue("http_4xx"), c5xx: byIssue("http_5xx"), none: byIssue("fetch_failed"), waf: byIssue("blocked_by_waf"), robots: byIssue("blocked_robots") };
    httpCounts = { c4xx: http.c4xx.length, c5xx: http.c5xx.length };
    const crawledAt = isoDay(crawl.startedAt);
    auditOut.push(
      `Crawl del ${date(crawl.startedAt)} · máx ${opts.maxPages ?? "–"} páginas${opts.render ? " · render JS" : " · HTML sin render JS"}${crawl.status === "partial" ? ` · **parcial**: ${crawl.reason ?? ""}` : ""}\n`,
      table(
        ["Salud técnica", "URLs", "4xx", "5xx", "Sin respuesta", "WAF", "Bloq. robots", "Redirects", "En sitemap", "Resp. media"],
        [[st.health ?? "–", pages.length || st.pages, http.c4xx.length, http.c5xx.length, http.none.length, http.waf.length, http.robots.length, st.redirects, st.sitemap, `${st.avgMs} ms`]]
      ),
      "",
      `_Errores HTTP: ${http.c4xx.length + http.c5xx.length + http.none.length} (${http.c4xx.length} con 4xx, ${http.c5xx.length} con 5xx, ${http.none.length} sin respuesta). Las bloqueadas por robots no son errores HTTP: el crawler no las pidió. La salud técnica es una métrica interna de esta herramienta, no de Google._`
    );
    if (st.trapPatterns?.length) auditOut.push(`\nPatrones de URL recortados (posibles trampas de crawl): ${st.trapPatterns.map((t: any) => `\`${t.pattern}\` (${t.skipped})`).join(", ")}`);

    // evidencia por URL con error: sin URL no hay tarea que se pueda hacer
    const httpRows = [...http.c4xx, ...http.c5xx, ...http.none, ...http.waf];
    if (httpRows.length)
      httpOut.push(
        `_Observado en el crawl del ${crawledAt}. La evidencia dice por qué el crawler pidió la URL (sitemap o páginas que la enlazan): si nadie la enlaza y no está en el sitemap, puede no ser un problema._\n`,
        table(["URL", "Tipo", "Evidencia"], httpRows.slice(0, 50).map((i) => [i.url, ISSUE_LABELS[i.code] ?? i.code, i.detail ?? (pageByKey.get(urlKey(i.url))?.inSitemap ? "en sitemap" : "–")]))
      );

    // falsos positivos → "parece intencional" (misma regla que la pantalla de Auditoría)
    const pagesFull = await db.page.findMany({ where: { crawlId: crawl.id }, select: { url: true, status: true, depth: true, inlinks: true, jsonldTypes: true, error: true, canonical: true } });
    const ins = buildFindings(pagesFull, issues, { cms: (st.cms as Cms) ?? null, hitLimit, impr: hasGsc ? imprByUrl : undefined });
    for (const it of ins.intentional) intentional.push(`- **${it.text}.** Ej.: ${it.examples.join(" · ")}`);
    const covered = new Set(ins.findings.flatMap((f) => f.urls.map((u) => `${f.code}|${u}`)));
    const real = issues.filter((i) => covered.has(`${i.code}|${i.url}`) || ["robots_missing", "sitemap_missing"].includes(i.code));
    const byCode = new Map<string, typeof real>();
    for (const i of real) byCode.set(i.code, [...(byCode.get(i.code) ?? []), i]);
    const codes = [...byCode.entries()].sort((a, b) => SEV_ORDER.indexOf(a[1][0].severity as any) - SEV_ORDER.indexOf(b[1][0].severity as any) || b[1].length - a[1].length);
    auditOut.push(
      "\n" +
        table(
          ["Estado", "Severidad", "Issue", "URLs", "Secciones más afectadas"],
          codes.map(([code, list]) => [KIND_LABEL[kindOf(code)], SEV_LABEL[list[0].severity], ISSUE_LABELS[code] ?? code, list.length, topSections(list.map((i) => i.url)).map(([s, n]) => `${s} (${n})`).join(", ")])
        )
    );
    // hallazgos: un problema por plantilla (causa raíz), no uno por URL; misma lógica que la pantalla de Auditoría
    patterns.push(...ins.patterns);
    const detailOf = new Map(issues.map((i) => [`${i.code}|${i.url}`, detailText(i.code, i.detail)]));
    for (const f of ins.findings) {
      const where = f.scope === "site" || f.scope === "layout" ? "todo el sitio" : f.scope === "scattered" ? "varias secciones" : `\`${f.template}\``;
      const tr = f.scope === "site" ? siteTraffic() : MINOR_ONPAGE.has(f.code) || kindOf(f.code) === "opportunity" ? trafficMinor(f.urls) : trafficOf(f.urls);
      const conf: Confidence = f.kind === "confirmed" ? "alta" : f.kind === "opportunity" ? "media" : "baja";
      // la evidencia va en la tarea: URL, valor observado y fecha
      const examples = f.urls.slice(0, 3).map((u) => `${u}${detailOf.get(`${f.code}|${u}`) ? ` — ${detailOf.get(`${f.code}|${u}`)}` : ""}`);
      tasks.push(
        makeTask({
          title: `${f.label} · ${where} (${f.urls.length} URL${f.urls.length === 1 ? "" : "s"})`,
          fix: `${f.rootCause || f.scope === "site" ? `${f.summary} ` : ""}${f.fix}`,
          traffic: tr.traffic,
          trafficLabel: tr.label,
          sev: SEV_WEIGHT[f.severity] ?? 1,
          sevLabel: `${SEV_LABEL[f.severity]} · ${KIND_LABEL[f.kind].toLowerCase()}`,
          ease: f.ease,
          minor: MINOR_ONPAGE.has(f.code),
          confidence: conf,
          evidence: `${KIND_LABEL[f.kind]} en el crawl del ${crawledAt}`,
          risk: ISSUE_RISK[f.code],
          verify: ISSUE_VERIFY[f.code] ?? DEFAULT_VERIFY,
          detail: examples,
        })
      );
    }
    for (const [code, list] of codes)
      appendix.push(
        `### ${ISSUE_LABELS[code] ?? code} (${list.length})\n`,
        ...list.slice(0, MAX_URLS).map((i) => `- ${i.url}${i.detail ? ` — ${detailText(i.code, i.detail)}` : ""}`),
        ...(list.length > MAX_URLS ? [`- … y ${list.length - MAX_URLS} más`] : []),
        ""
      );
  } else {
    auditOut.push(emptyText(mod("crawl")));
  }
  // ---------- Velocidad: campo primero, laboratorio solo sin datos de campo ----------
  const psi = await db.psiResult.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 200 });
  const psiLatest = new Map<string, (typeof psi)[number]>();
  for (const r of psi) if (!psiLatest.has(`${r.url}|${r.strategy}`)) psiLatest.set(`${r.url}|${r.strategy}`, r);
  const psiRows = [...psiLatest.values()].sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  const psiOut: string[] = [];
  for (const r of psiRows) {
    const lab = r.lab as Record<string, number | null>;
    const fld = r.field as PsiField;
    const v = psiVerdict(r.score, lab, fld);
    if (v.discrepancy) psiOut.push(`- ⚠ **${r.url}** (${r.strategy}): LCP laboratorio ${f0(lab.lcp)} ms vs usuarios reales ${f0(fld?.lcp?.p75)} ms. ${DISCREPANCY_HINT}`);
    if (!v.actionable && !(r.strategy === "mobile" && r.score != null && r.score < 50)) continue;
    const sec = urlSection(r.url);
    const tr = sectionTraffic(sec);
    const mobile = r.strategy === "mobile";
    const what = v.fieldBad
      ? `usuarios reales: LCP ${f0(fld?.lcp?.p75)} ms, INP ${f0(fld?.inp?.p75)} ms, CLS ${fieldCls(fld) ?? "–"}`
      : v.fieldComplete
        ? `laboratorio ${r.score}/100 pero los usuarios reales están dentro de los umbrales`
        : v.hasField
          ? `laboratorio ${r.score}/100; datos de campo incompletos, sin evaluación global`
        : `laboratorio ${r.score}/100 (sin datos de campo), LCP ${f0(lab.lcp)} ms`;
    tasks.push(
      makeTask({
        title: `Velocidad ${mobile ? "móvil" : "escritorio"} de la plantilla \`${sec}\` (${what})`,
        fix: v.discrepancy
          ? DISCREPANCY_HINT
          : "Optimizar la imagen principal (tamaño, formato, preload, sin lazy-load arriba), diferir JS que bloquea el render y reservar el espacio de anuncios/imágenes para evitar saltos.",
        traffic: tr.traffic,
        trafficLabel: tr.label,
        // datos de campo malos o laboratorio móvil < 50 sin campo: por encima de los issues on-page menores
        sev: v.actionable ? (mobile ? 3 : 2) : 1,
        sevLabel: v.actionable ? "alto" : "bajo",
        ease: 0.5,
        // datos de usuarios reales (CrUX) pesan más que una prueba de laboratorio
        confidence: v.fieldBad ? "alta" : v.discrepancy ? "baja" : "media",
        evidence: `PageSpeed ${r.strategy} del ${isoDay(r.createdAt)}: ${v.fieldBad ? `datos de usuarios reales (CrUX, ${fld?.source === "origin" ? "origen" : "URL"}, 28 días)` : v.fieldComplete ? "laboratorio malo, pero las tres métricas de campo (CrUX) están dentro de los umbrales" : v.hasField ? "datos de campo incompletos; no se puede concluir la evaluación de Core Web Vitals" : "solo laboratorio (una carga simulada), sin datos de usuarios reales"}`,
        verify: v.fieldBad ? "El p75 de campo baja de LCP 2,5 s / INP 200 ms / CLS 0,1 (tarda ~28 días en reflejarse)." : "La prueba de laboratorio mejora y, cuando haya datos de campo, se confirman ahí.",
      })
    );
  }

  // ---------- Indexación ----------
  const insp = await db.urlInspection.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 500 });
  const inspLatest = new Map<string, (typeof insp)[number]>();
  for (const r of insp) if (!inspLatest.has(r.url)) inspLatest.set(r.url, r);
  const notIndexed = [...inspLatest.values()].filter((r) => r.verdict && r.verdict !== "PASS");
  const canonMismatch = [...inspLatest.values()].filter((r) => r.googleCanonical && r.userCanonical && r.googleCanonical !== r.userCanonical);
  if (notIndexed.length) {
    const tr = hasGsc ? { traffic: notIndexed.reduce((s, r) => s + weight(r.url), 0) * 10, label: `${notIndexed.length} ${notIndexed.length === 1 ? "URL importante" : "URLs importantes"}` } : trafficOf(notIndexed.map((r) => r.url));
    tasks.push(makeTask({ title: `No indexadas según Google (${notIndexed.length} de las URLs principales)`, fix: "Revisar el estado de cobertura de cada una (sección Indexación): noindex, canonical, bloqueo o calidad.", traffic: tr.traffic, trafficLabel: tr.label, sev: 3, sevLabel: "crítico", ease: 0.6, confidence: "alta", evidence: "URL Inspection de Search Console", detail: notIndexed.slice(0, 5).map((r) => `${r.url} — ${r.coverageState ?? r.verdict} (${r.createdAt.toISOString().slice(0, 10)})`), verify: "Si la exclusión es intencional (noindex, canonical a otra URL, filtros), se conserva. Si no, la inspección pasa a «indexada» tras corregir y pedir indexación." }));
  }
  if (canonMismatch.length) {
    const tr = trafficOf(canonMismatch.map((r) => r.url));
    tasks.push(makeTask({ title: `Google eligió otro canonical (${canonMismatch.length} URL${canonMismatch.length === 1 ? "" : "s"})`, fix: "Unificar contenido/canonical para que coincidan con lo que Google elige.", traffic: tr.traffic, trafficLabel: tr.label, sev: 2, sevLabel: "warning", ease: 0.8, confidence: "alta", evidence: "URL Inspection de Search Console", risk: ISSUE_RISK.canonical_other, detail: canonMismatch.slice(0, 5).map((r) => `${r.url} — declarado ${r.userCanonical}, Google ${r.googleCanonical}`), verify: "El canonical que elige Google coincide con el declarado, o se confirma que la elección de Google es la correcta." }));
  }

  // ---------- Search Console ----------
  const gscOut: string[] = [];
  if (gscEnd && d28) {
    const gscConf = (impr: number): Confidence => (impr >= 1000 ? "alta" : impr >= 100 ? "media" : "baja");
    const gscEv = (impr: number) => `${f0(impr)} impresiones en ${isoDay(d28)} a ${isoDay(gscEnd)}`;
    gscOut.push(`_Período: ${periodLabel(period!, "rows")}._\n`);
    const qp = await db.gscRow.groupBy({ by: ["query", "page"], where: { projectId, date: { gte: d28, lt: end1! } }, _sum: { clicks: true, impressions: true }, _avg: { position: true } });
    const rows = qp.map((r) => ({ query: r.query, page: r.page, impressions: r._sum.impressions ?? 0, clicks: r._sum.clicks ?? 0, position: r._avg.position ?? 99 }));
    const nonBrand = rows.filter((r) => !isBrandQuery(r.query, brand));

    // Oportunidades 4–20, agrupadas por plantilla
    const striking = nonBrand.filter((r) => r.position >= 4 && r.position <= 20 && r.impressions >= 10);
    const bySec = new Map<string, typeof striking>();
    for (const r of striking) bySec.set(urlSection(r.page), [...(bySec.get(urlSection(r.page)) ?? []), r]);
    const secRows = [...bySec.entries()]
      .map(([sec, list]) => ({ sec, list: list.sort((a, b) => b.impressions - a.impressions), impr: list.reduce((s, r) => s + r.impressions, 0), pages: new Set(list.map((r) => r.page)).size }))
      .sort((a, b) => b.impr - a.impr);
    gscOut.push(
      "**Oportunidades: posición 4–20, por plantilla** (subir lo que ya rankea cerca de la primera página)\n",
      table(
        ["Plantilla", "Impr.", "Páginas", "Consultas principales"],
        secRows.slice(0, 15).map((s) => [s.sec, f0(s.impr), s.pages, s.list.slice(0, 5).map((r) => `${r.query} (pos ${f1(r.position)})`).join(" · ")])
      )
    );
    for (const s of secRows.slice(0, 10)) {
      const q = s.list.map((r) => r.query);
      const uniq = [...new Set(q)];
      const topPage = s.list[0].page;
      tasks.push(
        makeTask({
          title: `Subir posiciones 4–20 en \`${s.sec}\` (${pl(uniq.length, "consulta")}, ${pl(s.pages, "página")})`,
          fix: `En la plantilla: incluir «${uniq[0]}» en el title y el H1 de ${s.pages === 1 ? topPage : "cada página (con su dato variable)"}; agregar un H2 o párrafo que cubra ${uniq.slice(1, 4).map((x) => `«${x}»`).join(", ") || "las consultas relacionadas"}; sumar links internos con anchor «${uniq[0]}» hacia ${topPage} desde listados o páginas relacionadas.`,
          traffic: s.impr,
          trafficLabel: `${f0(s.impr)} impr`,
          sev: 2.5,
          sevLabel: "oportunidad",
          ease: 0.7,
          confidence: gscConf(s.impr),
          evidence: gscEv(s.impr),
          verify: "La posición media de esas consultas mejora en el período siguiente sin que bajen las demás consultas de la página.",
        })
      );
    }

    // CTR bajo para la posición (top 10)
    const lowCtr = nonBrand.filter((r) => r.position <= 10 && r.impressions >= 50 && r.clicks / r.impressions < expectedCtrAt(r.position) * 0.5);
    const lowBySec = new Map<string, typeof lowCtr>();
    for (const r of lowCtr) lowBySec.set(urlSection(r.page), [...(lowBySec.get(urlSection(r.page)) ?? []), r]);
    const lowRows = [...lowBySec.entries()]
      .map(([sec, list]) => ({ sec, list: list.sort((a, b) => b.impressions - a.impressions), impr: list.reduce((s, r) => s + r.impressions, 0), lost: Math.round(list.reduce((s, r) => s + r.impressions * expectedCtrAt(r.position) - r.clicks, 0)) }))
      .sort((a, b) => b.lost - a.lost);
    if (lowRows.length) {
      gscOut.push(
        "\n**CTR bajo para su posición** (en top 10 pero con muchos menos clics de lo esperable)\n",
        table(
          ["Plantilla", "Impr.", "Clics perdidos aprox.", "Consultas"],
          lowRows.slice(0, 10).map((s) => [s.sec, f0(s.impr), f0(s.lost), s.list.slice(0, 4).map((r) => `${r.query} (pos ${f1(r.position)}, CTR ${pctS(r.clicks / r.impressions)} vs ${pctS(expectedCtrAt(r.position))})`).join(" · ")])
        )
      );
      for (const s of lowRows.slice(0, 8))
        tasks.push(
          makeTask({
            title: `CTR bajo en \`${s.sec}\` (~${f0(s.lost)} clics/mes perdidos)`,
            fix: `Reescribir el title y la meta description de la plantilla para que respondan a ${s.list.slice(0, 3).map((r) => `«${r.query}»`).join(", ")}: la consulta al inicio del title, un beneficio concreto en la meta y sin texto genérico repetido en todas las páginas.`,
            traffic: s.impr,
            trafficLabel: `${f0(s.impr)} impr`,
            sev: 2,
            sevLabel: "oportunidad",
            ease: 1,
            confidence: gscConf(s.impr),
            evidence: `${gscEv(s.impr)}; CTR esperado según una curva promedio, no del sitio`,
            verify: "El CTR de esas consultas sube con posición similar. Google puede reescribir el title: revisar qué muestra realmente.",
          })
        );
    }

    // Variantes ortográficas que traen tráfico a la misma página
    const byPage = new Map<string, typeof rows>();
    for (const r of nonBrand) byPage.set(r.page, [...(byPage.get(r.page) ?? []), r]);
    const varBySec = new Map<string, { page: string; main: string; variants: string[]; impr: number }[]>();
    for (const [page, list] of byPage) {
      for (const g of spellingVariants(list)) {
        const sec = urlSection(page);
        const impr = g.variants.reduce((s, v) => s + v.impressions, 0);
        varBySec.set(sec, [...(varBySec.get(sec) ?? []), { page, main: g.main.query, variants: g.variants.map((v) => v.query), impr }]);
      }
    }
    const varRows = [...varBySec.entries()].map(([sec, list]) => ({ sec, list: list.sort((a, b) => b.impr - a.impr), impr: list.reduce((s, x) => s + x.impr, 0) })).sort((a, b) => b.impr - a.impr);
    if (varRows.length) {
      gscOut.push(
        "\n**Variantes ortográficas con tráfico** (la gente busca distinto lo mismo)\n",
        table(["Plantilla", "Impr. de variantes", "Variantes"], varRows.slice(0, 10).map((s) => [s.sec, f0(s.impr), s.list.slice(0, 4).map((x) => `${x.main} → ${x.variants.join(", ")}`).join(" · ")]))
      );
      for (const s of varRows.slice(0, 5)) {
        const terms = [...new Set(s.list.flatMap((x) => x.variants))].slice(0, 6);
        tasks.push(
          makeTask({
            title: `Cubrir variantes de escritura en \`${s.sec}\``,
            fix: `Mencionar de forma natural en el texto de la plantilla (intro, FAQ o alt de imágenes) las variantes ${terms.map((t) => `«${t}»`).join(", ")}, que hoy traen impresiones a la misma página.`,
            traffic: s.impr,
            trafficLabel: `${f0(s.impr)} impr`,
            sev: 1.5,
            sevLabel: "oportunidad",
            ease: 0.9,
            confidence: gscConf(s.impr),
            evidence: gscEv(s.impr),
            verify: "Las variantes aparecen en el texto visible de la página y, en el período siguiente, la página mantiene o sube impresiones para ellas.",
          })
        );
      }
    }

    // Top consultas
    const q = await db.gscRow.groupBy({ by: ["query"], where: { projectId, date: { gte: d28, lt: end1! } }, _sum: { clicks: true, impressions: true }, _avg: { position: true } });
    const topQ = [...q].sort((a, b) => (b._sum.clicks ?? 0) - (a._sum.clicks ?? 0)).slice(0, 20);
    gscOut.push("\n**Top consultas**\n", table(["Consulta", "Clicks", "Impr.", "Pos.", "Marca"], topQ.map((r) => [r.query, f0(r._sum.clicks), f0(r._sum.impressions), f1(r._avg.position), isBrandQuery(r.query, brand) ? "sí" : ""])));

    // Páginas que perdieron clics, por plantilla
    const d56 = period!.prevStart;
    const pg = (from: Date, to: Date) => db.gscRow.groupBy({ by: ["page"], where: { projectId, date: { gte: from, lt: to } }, _sum: { clicks: true } });
    const [pc, pp] = await Promise.all([pg(d28, end1!), pg(d56, d28)]);
    const prevMap = new Map(pp.map((r) => [r.page, r._sum.clicks ?? 0]));
    const drops = pc
      .map((r) => ({ page: r.page, now: r._sum.clicks ?? 0, before: prevMap.get(r.page) ?? 0 }))
      .concat(pp.filter((r) => !pc.some((c) => c.page === r.page)).map((r) => ({ page: r.page, now: 0, before: r._sum.clicks ?? 0 })))
      .filter((r) => r.before - r.now >= 5)
      .sort((a, b) => b.before - b.now - (a.before - a.now));
    gscOut.push("\n**Páginas que perdieron clics**\n", table(["Página", "Antes", "Ahora", "Δ"], drops.slice(0, 15).map((r) => [r.page, r.before, r.now, r.now - r.before])));
    const siteCtr = rows.reduce((s, r) => s + r.clicks, 0) / Math.max(1, rows.reduce((s, r) => s + r.impressions, 0)) || 0.02;
    const dropBySec = new Map<string, typeof drops>();
    for (const d of drops) dropBySec.set(urlSection(d.page), [...(dropBySec.get(urlSection(d.page)) ?? []), d]);
    for (const [sec, list] of [...dropBySec.entries()].sort((a, b) => b[1].reduce((s, r) => s + r.before - r.now, 0) - a[1].reduce((s, r) => s + r.before - r.now, 0)).slice(0, 5)) {
      const lost = list.reduce((s, r) => s + r.before - r.now, 0);
      tasks.push(
        makeTask({
          title: `Caída de clics en \`${sec}\` (−${f0(lost)} clics vs 28 días anteriores)`,
          fix: `Revisar cambios recientes, estado HTTP, indexación y contenido de ${list.slice(0, 3).map((r) => r.page).join(", ")}.`,
          // clics perdidos llevados a impresiones con el CTR del sitio, para comparar con el resto
          traffic: Math.round(lost / siteCtr),
          trafficLabel: `−${f0(lost)} clics`,
          sev: 2.5,
          sevLabel: "alto",
          ease: 0.6,
          confidence: lost >= 30 ? "alta" : lost >= 10 ? "media" : "baja",
          evidence: `clics ${isoDay(d28)} a ${isoDay(gscEnd)} contra los 28 días anteriores`,
          verify: "Se identificó la causa (cambio en la página, indexación, estacionalidad o competencia) y los clics del período siguiente vuelven al nivel anterior o se explica por qué no.",
        })
      );
    }
  } else {
    gscOut.push(emptyText(mod("gsc")));
  }

  // ---------- Alertas (canibalización: marca o todas en posición ≤ 1,5 = intencional) ----------
  const alerts = await db.alert.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 100 });
  const alertOut: string[] = [];
  const cannibal = alerts.filter((a) => a.type === "cannibal");
  const isIntentionalCannibal = (a: (typeof alerts)[number]) => {
    const d = a.data as any;
    if (isBrandQuery(a.key, brand)) return "consulta de marca";
    const pos: number[] = (d.pages ?? []).map((x: any) => x.position).filter((x: any) => typeof x === "number");
    if (pos.length >= 2 && pos.every((x) => x <= 1.5)) return "todas las URLs en posición ≤ 1,5";
    return null;
  };
  const cannibalOk = cannibal.map((a) => ({ a, why: isIntentionalCannibal(a) })).filter((x) => x.why);
  const cannibalReal = cannibal.filter((a) => !isIntentionalCannibal(a));
  if (cannibalOk.length) intentional.push(`- **Canibalización** en ${pl(cannibalOk.length, "consulta")} que no es un problema: ${cannibalOk.slice(0, 6).map((x) => `«${x.a.key}» (${x.why})`).join(", ")}`);
  if (cannibalReal.length) {
    alertOut.push("**Canibalización** (varias URLs compiten por la misma consulta)\n");
    for (const a of cannibalReal.slice(0, 20)) {
      const d = a.data as any;
      const ps: string[] = d.pages?.map((x: any) => `${x.page} (${f0(x.impressions)} impr, pos ${f1(x.position)})`) ?? d.urls ?? [];
      alertOut.push(`- **${a.key}**: ${ps.join(" · ")}`);
    }
    const impr = cannibalReal.reduce((s, a) => s + ((a.data as any).pages ?? []).reduce((t: number, x: any) => t + (x.impressions ?? 0), 0), 0);
    tasks.push(
      makeTask({
        title: `Canibalización en ${pl(cannibalReal.length, "consulta")}`,
        fix: "Por consulta, elegir la URL principal; diferenciar el enfoque de las otras (title/H1/contenido) o consolidarlas con 301/canonical. Detalle en Alertas.",
        traffic: impr || cannibalReal.length,
        trafficLabel: impr ? `${f0(impr)} impr` : `${cannibalReal.length} consultas`,
        sev: 2,
        sevLabel: "warning",
        ease: 0.5,
        confidence: "media",
        evidence: "varias URLs reciben impresiones por la misma consulta en Search Console",
        risk: "consolidar con 301 o canonical sin revisar la intención puede perder la página que mejor convierte",
        verify: "Para cada consulta, una sola URL concentra las impresiones durante 4 semanas seguidas, sin perder clics totales.",
      })
    );
  }
  const dropsRank = alerts.filter((a) => a.type === "drop");
  if (dropsRank.length) {
    alertOut.push("\n**Caídas de ranking**\n");
    for (const a of dropsRank.slice(0, 20)) {
      const d = a.data as any;
      alertOut.push(`- **${a.key}**: ${d.from ?? "–"} → ${d.to ?? "fuera del top 100"} · ${d.url ?? ""}`);
    }
  }

  // ---------- Rankings ----------
  const tracked = await db.trackedKeyword.findMany({ where: { projectId, active: true }, include: { checks: { orderBy: { date: "desc" }, take: 2 } } });
  const rankRows = tracked
    .map((t) => ({ k: t.keyword, pos: t.checks[0]?.position ?? null, prev: t.checks[1]?.position ?? null, url: t.checks[0]?.url ?? null, at: t.checks[0]?.date ?? null }))
    .sort((a, b) => (a.pos ?? 999) - (b.pos ?? 999));

  // ---------- Keywords ----------
  const kwOut: string[] = [];
  const run = await db.keywordRun.findFirst({ where: { projectId, status: "done" }, orderBy: { createdAt: "desc" } });
  if (run) {
    const clusters = await db.cluster.findMany({ where: { runId: run.id }, include: { topic: true, _count: { select: { keywords: true } } }, orderBy: { score: "desc" }, take: 40 });
    kwOut.push(`Research del ${date(run.createdAt)} · semillas: ${run.seeds.join(", ")}\n`);
    const rowsK = clusters.map((c) => {
      const own = c.urls.find(mine);
      return [c.topic?.name ?? "–", c.name, c.primary, f0(c.volume), c.intent ?? "–", c._count.keywords, own ? `optimizar ${own}` : "crear página"];
    });
    kwOut.push(table(["Topic", "Cluster", "Keyword principal", "Volumen", "Intención", "KWs", "Acción"], rowsK));
    const gaps = clusters.filter((c) => !c.urls.some(mine) && c.volume > 0).sort((a, b) => b.volume - a.volume).slice(0, 10);
    if (gaps.length) {
      const vol = gaps.reduce((s, c) => s + c.volume, 0);
      tasks.push(
        makeTask({
          title: `Crear páginas para ${pl(gaps.length, "cluster")} sin URL propia`,
          fix: `Una landing por cluster: ${gaps.slice(0, 6).map((c) => `«${c.primary}» (${f0(c.volume)}/mes)`).join(", ")}${gaps.length > 6 ? ", …" : ""}. Las keywords del cluster van en H2/texto.`,
          traffic: vol,
          trafficLabel: `${f0(vol)} búsquedas/mes`,
          sev: 1.5,
          sevLabel: "oportunidad",
          ease: 0.4,
          confidence: "baja",
          evidence: `volumen estimado por proveedor de keywords (research del ${isoDay(run.createdAt)}); confirmar intención y que el negocio ofrezca eso`,
          verify: "Antes de crear la página: confirmar que hay productos o servicios reales para esa búsqueda y que ninguna URL existente la cubre.",
        })
      );
    }
  } else {
    kwOut.push(emptyText(mod("keywords")));
  }

  // ---------- Contenido (entra en la priorización como cualquier tarea) ----------
  const contents = await db.contentAnalysis.findMany({ where: { projectId, status: "done" }, orderBy: { createdAt: "desc" }, take: 10 });
  const contentOut: string[] = [];
  // verificación al mostrar: los briefs guardados antes de una regla nueva también se revisan con el crawl actual
  const crawlPages = crawl ? await db.page.findMany({ where: { crawlId: crawl.id }, select: { url: true, status: true, finalUrl: true, title: true, h1: true } }) : [];
  const okUrls = crawlPages.filter((x) => x.status === 200 && (!x.finalUrl || x.finalUrl === x.url)).map((x) => x.url);
  const pageAt = new Map(crawlPages.map((x) => [urlKey(x.url), x]));
  // vocabulario del sitio (títulos y H1 de todas sus páginas): un término que no aparece en ninguna puede no ser del catálogo
  const siteVocab = crawlPages.map((x) => `${x.title ?? ""} ${x.h1.join(" ")}`).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const inCatalog = (t: string) => siteVocab.includes(t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
  for (const c of contents) {
    const r = c.result as any;
    const b = c.brief && (c.brief as any).titles ? verifyBrief(c.brief as any, { ownText: ownEvidence(r), knownUrls: okUrls.length ? okUrls : r.knownUrls ?? [], base: c.url }) : (c.brief as any);
    const missingAll: string[] = (r.terms ?? []).filter((t: any) => t.missing).slice(0, 20).map((t: any) => String(t.term));
    const missing = missingAll.filter(inCatalog).slice(0, 12);
    const foreign = missingAll.filter((t) => !inCatalog(t)).slice(0, 8);
    const bd = r.breakdown as Record<string, number> | undefined;
    const listing = r.pageType === "listing";
    const linkCheck = (to: string) => {
      const pg = (() => { try { return pageAt.get(urlKey(new URL(to, c.url).toString())); } catch { return undefined; } })();
      return pg ? `HTTP ${pg.status}${pg.finalUrl && pg.finalUrl !== pg.url ? ` → ${pg.finalUrl}` : ""}` : "no rastreada";
    };
    const unanswered = (r.paa ?? []).filter((x: any) => !x.answered).map((x: any) => x.q);
    const typeLabel: Record<string, string> = { listing: "listado", detail: "ficha", article: "artículo", home: "home" };
    contentOut.push(
      `### ${c.keyword} → ${c.url} · score ${c.score ?? "–"}/100\n`,
      r.pageType ? `- Google muestra: ${typeLabel[r.pageType] ?? r.pageType}s${r.mine?.type && r.mine.type !== r.pageType ? ` (la página es ${typeLabel[r.mine.type]})` : ""}` : "",
      bd ? `- Cómo se calcula el score (${c.score ?? "–"}/100, comparación con el top 10 del ${isoDay(c.createdAt)}): términos ${bd.terms}/${listing ? 50 : 40} · secciones ${bd.sections}/${listing ? 10 : 20} · preguntas ${bd.paa}/15 · extensión ${bd.length}/15 · datos estructurados ${bd.schema}/10. Es una medida de cobertura frente a los competidores, no de calidad ni de posición.` : "",
      `- Palabras editoriales: ${r.mine?.editorial ?? r.mine?.words ?? "–"} (mediana del top 10: ~${r.targetWords ?? "–"}; referencia, no un mínimo)`,
      r.target?.mismatch ? `- ⚠ Para «${c.keyword}» Google ya muestra ${r.target.gscUrl}: optimizar esa o diferenciar (riesgo de canibalización)` : "",
      missing.length ? `- Términos que usa la competencia y tu sitio tiene en otras páginas: ${missing.join(", ")}` : "",
      foreign.length ? `- Términos de la competencia que tu sitio no menciona en ninguna página (usar solo si los ofreces): ${foreign.join(", ")}` : "",
      unanswered.length ? `- Preguntas sin responder: ${unanswered.join(" · ")}` : "",
      b?.titles?.length ? `- Titles sugeridos: ${b.titles.slice(0, 3).map((t: string) => `"${t}"`).join(" · ")}` : "",
      b?.kind === "listing" && b?.intro ? `- Intro del listado: ${b.intro}` : "",
      b?.kind === "listing" && b?.filters?.length ? `- Filtros: ${b.filters.join(", ")}` : "",
      ((): string => {
        const bad = (b?.links ?? []).filter((l: any) => !/^HTTP 200$/.test(linkCheck(l.to)));
        if (b?.links?.length) checks.push([`links del brief de «${c.keyword}» responden 200 en el crawl`, !bad.length, bad.map((l: any) => `${l.to} (${linkCheck(l.to)})`).join(", ")]);
        return "";
      })(),
      b?.kind === "listing" && b?.links?.length ? `- Links internos (estado en el crawl del ${crawl ? isoDay(crawl.startedAt) : "–"}; confirmar contra el código): ${b.links.map((l: any) => `«${l.anchor}» → ${l.to} (${linkCheck(l.to)})`).join(" · ")}` : "",
      b?.warnings?.length ? `- ⚠ Verificar antes de publicar:\n${b.warnings.map((w: string) => `  - ${w}`).join("\n")}` : "",
      b?.kind !== "listing" && b?.outline?.length ? `- Outline sugerido:\n${b.outline.map((o: any) => `  ${o.tag === "h3" ? "  " : ""}- ${o.tag.toUpperCase()} ${o.text}`).join("\n")}` : "",
      ""
    );
    const score = c.score ?? 100;
    if (score < 75) {
      const kwImpr = hasGsc ? (await db.gscRow.aggregate({ where: { projectId, query: c.keyword.toLowerCase(), date: { gte: d28 ?? undefined, lt: end1 ?? undefined } }, _sum: { impressions: true } }))._sum.impressions ?? 0 : 0;
      const kwVol = (await db.keyword.findFirst({ where: { projectId, term: c.keyword.toLowerCase() }, select: { volume: true } }))?.volume ?? 0;
      const urlTr = trafficOf([c.url]);
      const traffic = Math.max(urlTr.traffic, kwImpr, kwVol);
      tasks.push(
        makeTask({
          title: `Contenido de ${c.url} para «${c.keyword}» (score ${score}/100)`,
          fix: `Aplicar el brief de la sección Contenido${r.pageType === "listing" ? " (página de listado: intro corta, filtros y links internos)" : ""}${missing.length ? `; cubrir ${missing.slice(0, 5).join(", ")}` : ""}. Usar solo productos, atributos y rutas que existen en el sitio.`,
          traffic,
          trafficLabel: traffic === kwVol && kwVol > urlTr.traffic ? `${f0(kwVol)} búsquedas/mes` : traffic === kwImpr && kwImpr > 0 ? `${f0(kwImpr)} impr de la keyword` : urlTr.label,
          sev: score < 40 ? 3 : score < 60 ? 2 : 1,
          sevLabel: score < 40 ? "alto" : score < 60 ? "medio" : "bajo",
          ease: 0.6,
          confidence: "media",
          evidence: `comparación con el top 10 de Google del ${isoDay(c.createdAt)}`,
          verify: "Los cambios usan datos reales del sitio (productos, atributos, rutas existentes) y la página se vuelve a analizar.",
        })
      );
    }
  }

  // ---------- Enlazado interno de las páginas que importan ----------
  const linkOut: string[] = [];
  if (crawl) {
    const withLinks = await db.page.findMany({ where: { crawlId: crawl.id }, select: { url: true, links: true } });
    const from = new Map<string, string[]>();
    for (const x of withLinks) for (const l of new Set(x.links)) if (l !== x.url) from.set(urlKey(l), [...(from.get(urlKey(l)) ?? []), x.url]);
    // páginas de origen ÚNICAS (sin parámetros): /catalogo?talla=m y /catalogo?color=rojo son la misma página
    const uniquePaths = (urls: string[]) => [...new Set(urls.map((u) => { try { return new URL(u).pathname; } catch { return u; } }))];
    const key = pages
      .filter((x) => x.status === 200 && !x.noindex && x.depth !== 0)
      .map((x) => ({ x, impr: imprByUrl.get(urlKey(x.url)) ?? 0 }))
      .sort((a, b) => b.impr - a.impr || b.x.inlinks - a.x.inlinks)
      .slice(0, 15);
    if (key.length)
      linkOut.push(
        `_Las ${key.length} páginas con más impresiones${imprByUrl.size ? "" : " (sin Search Console: las más enlazadas)"}: a qué profundidad están y desde dónde se enlazan en el HTML rastreado. Una página importante a 3+ clics o con pocos links entrantes merece links desde la home, el menú o categorías._\n`,
        table(
          ["Página", "Impr.", "Profundidad", "Páginas de origen (enlaces)", "Enlazada desde"],
          key.map(({ x, impr }) => {
            const src = from.get(urlKey(x.url)) ?? [];
            const uniq = uniquePaths(src);
            return [x.url, imprByUrl.size ? f0(impr) : "–", x.depth < 0 ? "solo sitemap" : x.depth, `${uniq.length} (${src.length})`, uniq.length ? `${uniq.slice(0, 3).join(", ")}${uniq.length > 3 ? ` (+${uniq.length - 3})` : ""}` : "ninguna en el HTML"];
          })
        )
      );
  }

  // ---------- Resultados: ¿los cambios movieron las métricas? ----------
  const resultsOut: string[] = [];
  const mk = await marketingOverview(projectId).catch(() => null);
  if (mk?.connected && mk.kpis) {
    const k = mk.kpis;
    resultsOut.push(
      `_${k.period.label}._\n`,
      `- **Clics:** ${f0(k.clicks.now)} en total = ${f0(k.brand.now)} de marca + ${f0(k.nonBrand.now)} sin marca + ${f0(k.unclassified.now)} no clasificables (consultas que Google anonimiza: no se sabe si son de marca).`,
      `- El aporte del SEO se lee en conjunto: clics sin marca (demanda nueva), clics de marca (notoriedad) y, si Analytics está conectado, conversiones e ingresos.${k.unclassified.now > k.brand.now + k.nonBrand.now ? " Con más clics no clasificables que clasificados, la división marca / sin marca es poco representativa." : ""}`
    );
    for (const [label, g] of [["Clics", mk.goalProgress!.clicks], ["Clics sin marca", mk.goalProgress!.nonBrandClicks]] as const)
      if (g.target != null) resultsOut.push(`- **Objetivo ${label.toLowerCase()} ${mk.goalProgress!.month}:** ${f0(g.mtd)} de ${f0(g.target)} con ${g.daysWithData}/${g.daysInMonth} días; proyección ${f0(g.projected)} (${g.status}).`);
    // anotaciones manuales siempre; tareas resueltas solo si su efecto ya es medible
    const changes = mk.annotations.filter((a) => a.kind === "manual" || (a.impact?.conclusive && a.impact.change != null)).slice(0, 10);
    if (changes.length)
      resultsOut.push(
        "",
        "**Efecto de los cambios** (clics/día en el alcance, ventanas iguales antes y después; no descuenta estacionalidad)\n",
        table(
          ["Fecha", "Cambio", "Clics/día", "Variación"],
          changes.map((a) => [a.date, `${a.title}${a.scope ? ` (${a.scope.replace(/^https?:\/\/[^/]+/, "")})` : ""}`, a.impact ? `${f1(a.impact.beforePerDay)} → ${f1(a.impact.afterPerDay)}` : "–", !a.impact ? "–" : !a.impact.conclusive ? (/días/.test(a.impact.note) ? "esperar datos" : "pocos clics") : a.impact.change != null ? `${a.impact.change >= 0 ? "+" : ""}${Math.round(a.impact.change * 100)} %` : "–"])
        )
      );
    else resultsOut.push("- Sin cambios anotados: anotar cada cambio publicado (Resultados → Cambios) para medir su efecto. Las tareas resueltas se miden solas.");
    if (mk.decay?.length) resultsOut.push("", `**Contenido en caída sostenida** (3 períodos de 28 días bajando): ${mk.decay.slice(0, 8).map((d) => `${d.page} (${d.clicks.join(" → ")})`).join(" · ")}`);
  }
  if (mk?.ga4 && !mk.ga4.empty) {
    const g = mk.ga4;
    const money = (v: number) => (g.currency ? new Intl.NumberFormat("es-CL", { style: "currency", currency: g.currency, maximumFractionDigits: 0 }).format(v) : f0(v));
    resultsOut.push(
      "",
      `**Conversiones del tráfico orgánico** (${g.note} ${g.period.start} a ${g.period.end}): ${f0(g.current.sessions)} sesiones (${pctChange(g.current.sessions, g.previous.sessions)}), ${f0(g.current.keyEvents)} conversiones (${pctChange(g.current.keyEvents, g.previous.keyEvents)}), ingresos ${money(g.current.revenue)} (${pctChange(g.current.revenue, g.previous.revenue)}).`,
      "",
      table(["Landing", "Sesiones", "Conversiones", "Tasa", "Ingresos"], g.landings.slice(0, 10).map((l) => [l.landing, f0(l.sessions), f0(l.keyEvents), pctS(l.conversionRate), money(l.revenue)])),
      ...(g.checks.length ? ["", ...g.checks.map((x) => `- ⚠ ${x}`)] : [])
    );
  } else if (mk && !mk.ga4) resultsOut.push("", "- Sin Google Analytics: no se miden conversiones ni ingresos del SEO. Conectarlo en Resultados.");
  if (mk?.competitors) {
    const c = mk.competitors;
    resultsOut.push(
      "",
      `**Competencia** (${c.keywords} keyword${c.keywords === 1 ? "" : "s"}, ${c.basis}${c.representative ? "" : `: vale solo para ${c.keywords === 1 ? "esa consulta" : "esas consultas"}, no describe el mercado`}): tu cuota de visibilidad ${pctS(c.ownShare)}. Primeros: ${c.top.slice(0, 5).map((x) => `${x.domain}${x.own ? " (tú)" : ""} ${pctS(x.share)}`).join(" · ")}. AI Overview en ${c.aiOverview.keywords} keywords; te cita en ${c.aiOverview.cited}.`
    );
  }

  // ---------- Cambios desde el crawl anterior ----------
  const changesOut: string[] = [];
  const ch = await latestCrawlChanges(projectId);
  if (ch?.changes.length) {
    const byField = new Map<string, typeof ch.changes>();
    for (const c of ch.changes) byField.set(c.field, [...(byField.get(c.field) ?? []), c]);
    changesOut.push(
      `_Crawl del ${isoDay(ch.previous.startedAt)} contra el del ${isoDay(ch.current.startedAt)}. Un cambio que nadie pidió (sobre todo en noindex, canonical o estado HTTP) suele venir de un deploy: confirmar que fue intencional._\n`,
      table(
        ["Qué cambió", "URLs", "Ejemplo"],
        [...byField.entries()].sort((a, b) => b[1].length - a[1].length).map(([f, l]) => [FIELD_LABEL[f as keyof typeof FIELD_LABEL], l.length, `${l[0].url}: «${l[0].before}» → «${l[0].after}»`])
      )
    );
  }

  // ---------- Backlinks ----------
  const blOut: string[] = [];
  const bl = (await backlinksOverview(projectId)).snapshot;
  if (bl) {
    const blDay = bl.at.slice(0, 10);
    const s = bl.summary;
    blOut.push(
      `_DataForSEO, foto del ${blDay}. Dominios de referencia = sitios distintos que enlazan; pesa más que el total de links._\n`,
      table(
        ["Sitio", "Dominios de referencia", "Backlinks", "Rank (0–1000)", "Links rotos entrantes"],
        [s, ...bl.competitorSummaries].map((x) => [x.target === bl.target ? `${x.target} (tú)` : x.target, f0(x.referringDomains), f0(x.backlinks), f0(x.rank), f0(x.brokenBacklinks)])
      )
    );
    if (bl.previous) blOut.push("", `Variación desde la foto anterior: ${f0(s.referringDomains - bl.previous.referringDomains)} dominios de referencia.`);
    if (bl.newDomains.length) blOut.push("", `**Nuevos (30 días):** ${bl.newDomains.slice(0, 10).map((d) => `${d.domain} (rank ${d.rank})`).join(" · ")}`);
    if (bl.lost.length) blOut.push("", `**Perdidos:** ${bl.lost.slice(0, 10).map((d) => `${d.domain} (rank ${d.rank}${d.lostDate ? `, ${String(d.lostDate).slice(0, 10)}` : ""})`).join(" · ")}`);
    if (bl.errors.length) blOut.push("", `_Sin datos en: ${bl.errors.join("; ")}._`);
    // links que llegan a páginas con error: se recuperan con un 301, es lo más rentable en link building
    const brokenTargets = new Map<string, typeof bl.broken>();
    for (const b of bl.broken) brokenTargets.set(b.to, [...(brokenTargets.get(b.to) ?? []), b]);
    if (brokenTargets.size) {
      const rows = [...brokenTargets.entries()].sort((a, b) => Math.max(...b[1].map((x) => x.rank)) - Math.max(...a[1].map((x) => x.rank)));
      blOut.push("", "**Backlinks que llegan a páginas con error**\n", table(["Página destino", "Estado", "Links", "Desde (mejor dominio)"], rows.slice(0, 15).map(([to, l]) => [to, l[0].status ?? "–", l.length, l.sort((a, b) => b.rank - a.rank)[0].from])));
      tasks.push(
        makeTask({
          title: `Recuperar ${pl(bl.broken.length, "backlink")} que llegan a ${pl(brokenTargets.size, "página")} con error`,
          fix: `Redirigir con 301 cada URL destino a su equivalente actual (o restaurarla): ${rows.slice(0, 3).map(([to]) => to).join(", ")}${rows.length > 3 ? "…" : ""}. Así esos links vuelven a contar.`,
          traffic: Math.max(1, ...rows.flatMap(([, l]) => l.map((x) => x.rank))),
          trafficLabel: "rank del mejor dominio que enlaza",
          sev: 2.5,
          sevLabel: "alto",
          ease: 0.9,
          confidence: "alta",
          evidence: `DataForSEO, foto del ${blDay}: backlinks con destino en error`,
          risk: ISSUE_RISK.http_4xx,
          verify: "Las URLs destino responden 200 o 301 a una página equivalente que responde 200.",
          detail: rows.slice(0, 3).map(([to, l]) => `${to} — HTTP ${l[0].status ?? "?"} · ${l.length} link(s), ej. ${l[0].from}`),
        })
      );
    }
    if (bl.gap.length) {
      blOut.push("", `**Enlazan a ${bl.competitors.length > 1 ? "todos tus competidores" : "tu competidor"} (${bl.competitors.join(", ")}) y no a ti:** ${bl.gap.slice(0, 15).map((g) => `${g.domain} (rank ${g.rank})`).join(" · ")}`);
      tasks.push(
        makeTask({
          title: `Conseguir links de ${pl(Math.min(bl.gap.length, 50), "dominio")} que ya enlazan a la competencia`,
          fix: `Empezar por los de más autoridad: ${bl.gap.slice(0, 5).map((g) => g.domain).join(", ")}. Revisar qué enlazan de la competencia (directorios, prensa, proveedores, asociaciones) y proponer algo equivalente.`,
          traffic: bl.gap.slice(0, 10).reduce((sum, g) => sum + g.rank, 0) / 10,
          trafficLabel: "rank medio de los 10 mejores dominios",
          sev: 1.5,
          sevLabel: "oportunidad",
          ease: 0.4,
          confidence: "media",
          evidence: `DataForSEO, foto del ${blDay}; competidores ${bl.competitors.join(", ")}`,
          verify: "Los dominios contactados aparecen como dominios de referencia en la próxima foto.",
        })
      );
    }
  }

  // ---------- Visibilidad en IA y SEO local ----------
  const aiOut: string[] = [];
  const al = await aiLocalOverview(projectId);
  if (al.ai) {
    aiOut.push(
      `_Serpent AI Ranking del ${al.ai.at.slice(0, 10)}: si cada IA cita el sitio al responder las keywords monitoreadas._\n`,
      table(["IA", "Te cita", "Keywords"], al.ai.engines.map((e) => [e.engine, `${e.found} (${pctS(e.share)})`, e.total])),
      "",
      `**Más citados por las IA:** ${al.ai.topCited.slice(0, 8).map((c) => `${c.domain} (${c.count})`).join(" · ") || "–"}`
    );
    const missing = al.ai.keywords.filter((k) => k.engines.every((e) => !e.found));
    if (missing.length)
      tasks.push(
        makeTask({
          title: `Aparecer en las respuestas de IA para ${pl(missing.length, "keyword")}`,
          fix: `Ninguna IA cita el sitio para ${missing.slice(0, 4).map((k) => `«${k.keyword}»`).join(", ")}. Las IA citan páginas que responden la pregunta de forma directa y verificable: una sección con la respuesta corta arriba, datos concretos propios (precios, medidas, comparaciones), FAQ y datos estructurados. Revisar qué dominios citan en su lugar.`,
          traffic: missing.length * 10,
          trafficLabel: `${missing.length} keywords sin cita`,
          sev: 1.5,
          sevLabel: "oportunidad",
          ease: 0.5,
          confidence: "media",
          evidence: `Serpent AI Ranking del ${al.ai.at.slice(0, 10)} (ChatGPT, Claude, Gemini, Perplexity)`,
          verify: "En la siguiente revisión semanal, al menos una IA cita el sitio para esas keywords.",
        })
      );
  }
  if (al.localRanks) {
    aiOut.push(
      "",
      `**Google Maps** (${al.localRanks.at.slice(0, 10)}, ${al.localRanks.rows[0]?.location ?? ""})\n`,
      table(["Keyword", "Posición", "Antes", "Rating", "Top 3"], al.localRanks.rows.map((r) => [r.keyword, r.position ?? "no aparece", r.previous ?? "–", r.rating ?? "–", r.top.map((t) => `${t.name}${t.rating ? ` (${t.rating})` : ""}`).join(" · ")]))
    );
    const out3 = al.localRanks.rows.filter((r) => r.position == null || r.position > 3);
    if (out3.length)
      tasks.push(
        makeTask({
          title: `Entrar al top 3 de Google Maps en ${pl(out3.length, "búsqueda")} local${out3.length === 1 ? "" : "es"}`,
          fix: "Completar la ficha de Google Business Profile (categoría principal exacta, horarios, fotos, productos/servicios), pedir reseñas a clientes y responderlas, y mantener nombre, dirección y teléfono idénticos en el sitio y en directorios.",
          traffic: out3.length * 20,
          trafficLabel: `${out3.length} búsquedas locales fuera del top 3`,
          sev: 2,
          sevLabel: "oportunidad",
          ease: 0.6,
          confidence: "media",
          evidence: `Serpent Google Maps del ${al.localRanks.at.slice(0, 10)}`,
        })
      );
  }

  // ---------- Keyword gap y estacionalidad ----------
  const gapOut: string[] = [];
  const kg = await gapOverview(projectId);
  if (kg.gap?.items.length) {
    const g = kg.gap;
    gapOut.push(
      `_DataForSEO Labs, ${g.at.slice(0, 10)}: keywords donde ${g.competitors.join(", ")} está en el top 20 y el sitio no aparece. Confirmar que el negocio ofrece eso antes de crear contenido._\n`,
      table(["Keyword", "Búsquedas/mes", "Competidor (pos.)", "Meses pico"], g.items.slice(0, 20).map((i) => [i.keyword, f0(i.volume), i.competitors.map((c) => `${c.domain} (${c.position})`).join(", "), i.peaks.length ? i.peaks.map((m) => ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][m - 1]).join(", ") : "pareja"]))
    );
    const vol = g.items.slice(0, 20).reduce((s, i) => s + i.volume, 0);
    tasks.push(
      makeTask({
        title: `Cubrir ${pl(Math.min(g.items.length, 20), "keyword")} que traen tráfico a la competencia`,
        fix: `Revisar las primeras (${g.items.slice(0, 5).map((i) => `«${i.keyword}»`).join(", ")}): si el negocio lo ofrece, optimizar la página que corresponde o crear una; usar la página del competidor como referencia de intención, no para copiar.`,
        traffic: vol,
        trafficLabel: `${f0(vol)} búsquedas/mes`,
        sev: 1.5,
        sevLabel: "oportunidad",
        ease: 0.4,
        confidence: "media",
        evidence: `DataForSEO Labs del ${g.at.slice(0, 10)}; volumen estimado`,
        verify: "La URL propia aparece en Search Console con impresiones para esas keywords.",
      })
    );
  }
  if (kg.upcoming.length)
    gapOut.push("", `**Se viene la temporada** (pico en los próximos 2 meses: publicar o actualizar ahora): ${kg.upcoming.slice(0, 10).map((u) => `«${u.keyword}» (${u.peaks})`).join(" · ")}`);

  // ---------- Validación del informe ----------
  // el resumen no puede contradecir sus tablas: se comprueba antes de entregar
  if (httpCounts) {
    const t4 = tasks.filter((t) => t.title.startsWith(ISSUE_LABELS.http_4xx)).length;
    const t5 = tasks.filter((t) => t.title.startsWith(ISSUE_LABELS.http_5xx)).length;
    checks.push(["tareas de 4xx/5xx coinciden con la tabla HTTP de la auditoría", (t4 > 0) === (httpCounts.c4xx > 0) && (t5 > 0) === (httpCounts.c5xx > 0), `tareas 4xx: ${t4}, tabla: ${httpCounts.c4xx}; tareas 5xx: ${t5}, tabla: ${httpCounts.c5xx}`]);
  }
  const auditTasks = tasks.filter((t) => / · .*\(\d+ URLs?\)$/.test(t.title));
  checks.push(["cada tarea de auditoría trae evidencia (URL y valor observado)", auditTasks.every((t) => t.detail?.length), auditTasks.filter((t) => !t.detail?.length).map((t) => t.title).join(", ")]);
  checks.push(["cada tarea trae una verificación concreta", tasks.every((t) => t.verify && t.verify !== DEFAULT_VERIFY), tasks.filter((t) => !t.verify || t.verify === DEFAULT_VERIFY).map((t) => t.title).slice(0, 5).join(", ")]);
  if (mk?.connected && mk.kpis) {
    const k = mk.kpis;
    const sum = k.brand.now + k.nonBrand.now + k.unclassified.now;
    checks.push(["clics de marca + sin marca + no clasificables = total", !k.unclassified.now || sum === k.clicks.now, `${sum} vs ${k.clicks.now}`]);
  }
  if (!inspLatest.size) checks.push(["indexación sin inspecciones se informa como «no medido» (no como 0)", true]);

  // ---------- Armado ----------
  tasks.sort(byPriority);
  const top = tasks.slice(0, MAX_TASKS);
  const rest = tasks.slice(MAX_TASKS);
  const out: string[] = [];
  out.push(
    `# Informe SEO · ${site}`,
    "",
    `Generado ${date(new Date())} · país ${p.country.toUpperCase()} · idioma ${p.language} · reglas v${RULES_VERSION}`,
    "",
    `**Fuentes de esta versión:** ${[crawl ? `crawl del ${date(crawl.startedAt)} (id ${crawl.id.slice(-8)}${crawl.status === "partial" ? ", parcial" : ""})` : "sin crawl", period ? `Search Console ${isoDay(period.start)} a ${isoDay(period.end)}, propiedad ${p.gscProperty ?? "–"}, todos los países y dispositivos, búsqueda web` : "sin Search Console"].join(" · ")}. Todas las tablas y tareas salen de estas mismas fuentes.`,
    "",
    "> **Para el agente que edita el código:** este informe viene de un análisis externo del sitio en producción. Las tareas están ordenadas por impacto (tráfico afectado × severidad × facilidad × confianza). Cada una trae su evidencia (URL, valor observado, fecha): compruébala contra el código antes de cambiar, porque una hipótesis puede ser un comportamiento intencional del sitio (variantes, filtros, links condicionales). Para cada una, ubica en el repositorio la ruta/plantilla indicada (p. ej. `/perfil/*`) y corrige ahí, no URL por URL. No inventes datos de negocio; si un texto depende de datos reales, genéralo desde los campos existentes. Antes de cambiar redirects, canonicals o robots.txt, confirma que no se pierdan páginas indexadas.",
    ""
  );
  if (checks.some(([, ok]) => !ok)) out.push(`> ⚠ **Este informe tiene inconsistencias internas** (ver «Validación del informe» al final). No entregarlo sin revisarlas.`, "");
  // qué datos respaldan este informe: "sin datos" no es lo mismo que "falló"
  out.push(
    "## Cobertura de datos",
    "",
    table(["Módulo", "Estado", "Detalle"], cov.map((m) => [m.label, `${m.state === "ok" ? "✓" : m.state === "failed" ? "✗" : m.state === "partial" ? "◐" : "–"} ${STATE_LABEL[m.state]}`, m.detail])),
    ...(cov.some((m) => m.state === "failed") ? ["", "> ⚠ Hay módulos cuyo último intento falló: lo que muestra este informe para ellos puede estar desactualizado o incompleto."] : []),
    ""
  );
  const missing = cov.filter((m) => m.state !== "ok").map((m) => m.label);
  if (missing.length) out.push(`> **Diagnóstico parcial.** Este informe no evalúa con datos completos: ${missing.join(", ")}. Lo que dependa de esos módulos no está medido, no es que esté bien.`, "");
  if (trends.length) out.push("## Tendencias", "", ...trends, "");
  if (resultsOut.length) out.push("## Resultados", "", ...resultsOut, "");
  // URLs: descubiertas → rastreadas → con impresiones → inspeccionadas
  if (crawl || imprByUrl.size || inspLatest.size) {
    const ok200 = pages.filter((x) => x.status === 200 && !x.error && !(x.redirects as unknown[]).length);
    const withImpr = ok200.filter((x) => (imprByUrl.get(urlKey(x.url)) ?? 0) > 0).length;
    const gscOnly = [...imprByUrl.keys()].filter((k) => !pageByKey.has(k)).length;
    const passed = [...inspLatest.values()].filter((r) => r.verdict === "PASS").length;
    out.push(
      "## URLs: descubiertas, rastreadas e indexadas",
      "",
      table(
        ["Etapa", "URLs", "Fuente"],
        [
          ["En el sitemap", f0((crawl?.stats as any)?.sitemap ?? 0), "sitemap.xml"],
          ["Rastreadas", f0(pages.length), crawl ? `crawl del ${isoDay(crawl.startedAt)}` : "sin crawl"],
          ["Responden 200 sin redirigir", f0(ok200.length), "crawl"],
          ["  · con impresiones en Google", f0(withImpr), period ? `Search Console ${isoDay(period.start)} a ${isoDay(period.end)}` : "sin Search Console"],
          ["  · con noindex", f0(ok200.filter((x) => x.noindex).length), "crawl"],
          ["Con impresiones pero no rastreadas", f0(gscOnly), "Search Console vs crawl"],
          ["Inspeccionadas (URL Inspection)", f0(inspLatest.size), "Search Console"],
          // sin inspecciones no hay "0 indexadas": hay estado no medido
          ["  · indexadas", inspLatest.size ? f0(passed) : "no medido", "Search Console"],
          ["  · no indexadas o excluidas", inspLatest.size ? f0(inspLatest.size - passed) : "no medido", "Search Console"],
        ]
      ),
      "",
      "_Tener impresiones prueba que la URL está indexada; no tenerlas no prueba lo contrario. Solo URL Inspection confirma el estado, y solo se inspeccionan las URLs principales._",
      ""
    );
  }
  if (notes.length) out.push("## Avisos", "", ...notes.map((n) => `- ${n}`), "");
  out.push(
    "## Tareas por impacto",
    "",
    "**Cómo se prioriza.** Impacto = tráfico afectado × severidad × facilidad × confianza.",
    "",
    `- **Tráfico:** ${hasGsc ? `impresiones de Search Console (${isoDay(period!.start)} a ${isoDay(period!.end)}) de las URLs afectadas.` : `${imprByUrl.size ? `hay menos de ${f0(LOW_GSC_IMPRESSIONS)} impresiones en 28 días, así que no se usan para ordenar` : "sin Search Console"}: se usa el peso de cada URL en el sitio (1 + log₂(1 + links entrantes), +3 la home).`}`,
    `- **Severidad:** error ${SEV_WEIGHT.critical}, advertencia ${SEV_WEIGHT.warning}, observación ${SEV_WEIGHT.info}; oportunidades de Search Console 1,5–2,5.`,
    "- **Facilidad:** 1 = cambio de plantilla rápido, 0,4 = trabajo de contenido o arquitectura.",
    `- **Confianza:** alta ×${CONFIDENCE_FACTOR.alta} (error comprobado o datos de usuarios reales), media ×${CONFIDENCE_FACTOR.media}, baja ×${CONFIDENCE_FACTOR.baja} (hipótesis, pocos datos o estimaciones). Las mejoras on-page menores además ×${MINOR_FACTOR}.`,
    "",
    "_Los pesos son una convención de esta herramienta para ordenar el trabajo, no una medida de cuánto tráfico se va a ganar._",
    "",
    top.length
      ? top
          .map((t, i) =>
            [
              `${i + 1}. **${t.title}** — ${t.fix}`,
              ...(t.detail?.length ? [`   - Evidencia: ${t.detail.join(" · ")}`] : []),
              `   - Confianza ${t.confidence ?? "media"}${t.evidence ? `: ${t.evidence}` : ""}.${t.risk ? ` Riesgo: ${t.risk}.` : ""}`,
              ...(t.verify ? [`   - Verificación: ${t.verify}`] : []),
              `   - _Impacto ${f0(t.score)} = ${t.trafficLabel} × ${t.sevLabel} × ${EASE_LABEL(t.ease)} × confianza ${t.confidence ?? "media"}${t.minor ? " × ½ (on-page menor)" : ""}_`,
            ].join("\n")
          )
          .join("\n")
      : "_Nada pendiente con los datos actuales._",
    ""
  );
  if (rest.length) out.push("### Tareas menores", "", table(["Tarea", "Impacto", "Confianza"], rest.map((t) => [t.title, f0(t.score), t.confidence ?? "media"])), "");
  // cada problema se describe una sola vez (en su tarea); acá solo patrones que cruzan varias tareas
  if (patterns.length) out.push("## Patrones", "", "_Coincidencias entre tareas; no son tareas nuevas. El detalle de cada problema está en su tarea y las URLs en el anexo._", "", ...patterns.map((x) => `- ${x.text}`), "");
  if (intentional.length) out.push("## Revisado, parece intencional", "", "_Comportamiento esperado del sitio: no se generan tareas y no hay que «corregirlo». Confirmar solo si no corresponde a lo que el sitio quiere._", "", ...intentional, "");
  out.push("## Search Console", "", ...gscOut, "");
  if (aiOut.length) out.push("## Visibilidad en IA y SEO local", "", ...aiOut, "");
  if (gapOut.length) out.push("## Keywords de la competencia y estacionalidad", "", ...gapOut, "");
  out.push("## Backlinks", "", ...(blOut.length ? blOut : [emptyText(mod("backlinks"))]), "");
  out.push(
    "## Velocidad (PageSpeed)",
    "",
    ...(psiOut.length ? [...psiOut, ""] : []),
    !psiRows.length ? emptyText(mod("psi")) : table(
      ["URL", "Estrategia", "Score lab", "LCP lab ms", "Usuarios reales (campo)"],
      psiRows.map((r) => {
        const lab = r.lab as Record<string, number | null>;
        const fld = r.field as Record<string, any>;
        return [r.url, r.strategy, r.score ?? "–", f0(lab.lcp), fld?.source ? `${fld.source === "origin" ? "origen" : "URL"} · LCP ${f0(fld.lcp?.p75)} · INP ${f0(fld.inp?.p75)} · CLS ${fieldCls(fld) ?? "–"}` : "sin datos"];
      })
    ),
    ""
  );
  out.push("## Auditoría técnica", "", ...auditOut, "");
  if (httpOut.length) out.push("### Errores HTTP con evidencia", "", ...httpOut, "");
  if (linkOut.length) out.push("### Enlazado interno de páginas clave", "", ...linkOut, "");
  if (changesOut.length) out.push("### Cambios desde el crawl anterior", "", ...changesOut, "");
  out.push(
    "## Indexación (URL Inspection)",
    "",
    inspLatest.size
      ? table(["URL", "Veredicto", "Cobertura", "Canonical Google", "Canonical declarado", "Último rastreo"], [...inspLatest.values()].map((r) => [r.url, r.verdict, r.coverageState, r.googleCanonical, r.userCanonical, r.lastCrawl?.toISOString().slice(0, 10)]))
      : emptyText(mod("inspect")),
    ""
  );
  if (alertOut.length) out.push("## Alertas", "", ...alertOut, "");
  out.push(
    "## Rankings",
    "",
    rankRows.length ? table(["Keyword", "Pos.", "Anterior", "URL", "Revisado"], rankRows.map((r) => [r.k, r.pos ?? (r.at ? ">100" : "–"), r.prev ?? "–", r.url, r.at?.toISOString().slice(0, 10)])) : emptyText(mod("rank")),
    ""
  );
  out.push("## Keywords y clusters", "", ...kwOut, "");
  if (contentOut.length) out.push("## Contenido", "", ...contentOut.filter((l) => l !== ""), "");
  const failed = checks.filter(([, ok]) => !ok);
  out.push(
    "## Validación del informe",
    "",
    failed.length
      ? `⚠ ${failed.length} de ${checks.length} chequeos de consistencia fallaron: revisar antes de entregar.\n\n${failed.map(([what, , why]) => `- ✗ ${what}${why ? `: ${why}` : ""}`).join("\n")}`
      : `✓ ${checks.length} chequeos de consistencia pasaron: ${checks.map(([what]) => what).join("; ")}.`,
    ""
  );
  const advice = await adviceReport(projectId);
  const prose = (text: string) => text.replace(/[\\`*_{}\[\]<>#]/g, "\\$&");
  out.push("## Próximos pasos para el negocio", "", `Objetivo: ${advice.goalLabel}. Las explicaciones son propuestas y no cambian los hallazgos medidos.`, "");
  for (const action of advice.actions.slice(0, 5)) {
    out.push(`### ${prose(action.title)}`, "", `Prioridad ${action.priority.toLowerCase()} · ${action.confidence}.`, prose(action.ai?.explanation ?? action.why));
    if (action.ai) out.push("Explicación sugerida con IA, validada contra las referencias del hallazgo.");
    out.push(...(action.ai?.steps ?? action.steps).map(s => `- ${prose(s)}`), `Comprobar: ${prose(action.ai?.verify ?? action.verify)}`);
    out.push(...action.evidence.map(e => `- Evidencia (${e.source}${e.at ? `, ${e.at}` : ""}): ${prose(e.observation)}`), "");
  }
  out.push("Revisiones pendientes:", ...advice.checks.filter(c => c.status !== "available").map(c => `- ${prose(c.title)}: ${prose(c.detail)}`), "");
  if (appendix.length) out.push("## Anexo: URLs por issue", "", `Hasta ${MAX_URLS} URLs por issue.`, "", ...appendix);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
