import { db } from "./db";
import { env } from "./env";
import { ISSUE_LABELS } from "./audit/issues";
import { ISSUE_FIX } from "./audit/fixes";
import { hostOf, urlKey } from "./util";
import { coverage, emptyText, STATE_LABEL } from "./coverage";
import { buildFindings, KIND_LABEL, urlSection, type Pattern } from "./audit/insights";
import type { Cms } from "./audit/cms";
import { brandFromDomain, DISCREPANCY_HINT, EASE, EASE_LABEL, expectedCtrAt, isBrandQuery, isParamCanonical, makeTask, PRIVATE_PATH, psiVerdict, SEV_WEIGHT, byPriority, MINOR_ONPAGE, spellingVariants, type PsiField, type Task } from "./report-rules";

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

const pctChange = (now: number, before: number) => (before ? `${now >= before ? "+" : ""}${(((now - before) / before) * 100).toFixed(1).replace(".", ",")} %` : "sin período anterior");
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
  const notes: string[] = [];
  const intentional: string[] = [];
  const trends: string[] = [];
  const rootCauses: string[] = [];
  const patterns: Pattern[] = [];

  // ---------- Tráfico por URL (GSC 28 días) y peso de plantilla (sin GSC) ----------
  const lastGsc = await db.gscRow.findFirst({ where: { projectId }, orderBy: { date: "desc" }, select: { date: true } });
  const gscEnd = lastGsc?.date ?? null;
  const d28 = gscEnd ? new Date(gscEnd.getTime() - 27 * 864e5) : null;
  const imprByUrl = new Map<string, number>();
  let siteImpr = 0;
  if (d28) {
    const byPage = await db.gscRow.groupBy({ by: ["page"], where: { projectId, date: { gte: d28 } }, _sum: { impressions: true } });
    for (const r of byPage) {
      const k = urlKey(r.page);
      imprByUrl.set(k, (imprByUrl.get(k) ?? 0) + (r._sum.impressions ?? 0));
      siteImpr += r._sum.impressions ?? 0;
    }
  }
  const hasGsc = imprByUrl.size > 0;
  const crawl = await db.crawl.findFirst({ where: { projectId, status: { in: ["completed", "partial"] } }, orderBy: { startedAt: "desc" } });
  const pages = crawl ? await db.page.findMany({ where: { crawlId: crawl.id }, select: { url: true, inlinks: true, outlinks: true, depth: true, status: true, canonical: true } }) : [];
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
    return { traffic: v, label: `peso ${f1(v)} (sin GSC)` };
  };
  /** tráfico de toda una plantilla (sección) */
  const sectionTraffic = (section: string) => trafficOf(pages.filter((x) => urlSection(x.url) === section).map((x) => x.url).concat(hasGsc ? [...imprByUrl.keys()].filter((k) => urlSection(`https://${k}`) === section && !pageByKey.has(k)).map((k) => `https://${k}`) : []));
  const siteTraffic = () => (hasGsc ? { traffic: siteImpr, label: `${f0(siteImpr)} impr (todo el sitio)` } : trafficOf(pages.map((x) => x.url)));

  // ---------- Tendencias ----------
  if (gscEnd && d28) {
    const d56 = new Date(gscEnd.getTime() - 55 * 864e5);
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
    const end1 = new Date(gscEnd.getTime() + 864e5);
    const [cur, prev] = await Promise.all([agg(d28, end1), agg(d56, d28)]);
    trends.push(
      `- **Clics:** ${f0(cur.c)} (${pctChange(cur.c, prev.c)})`,
      `- **Impresiones:** ${f0(cur.i)} (${pctChange(cur.i, prev.i)})`,
      `- **CTR:** ${pctS(cur.i ? cur.c / cur.i : null)} (antes ${pctS(prev.i ? prev.c / prev.i : null)})`,
      ...(cur.pos != null && prev.pos != null ? [`- **Posición media:** ${f1(cur.pos)} (antes ${f1(prev.pos)})`] : []),
      "",
      `_Últimos 28 días hasta ${gscEnd.toISOString().slice(0, 10)} contra los 28 anteriores._`
    );
  }

  // ---------- Auditoría ----------
  const auditOut: string[] = [];
  const appendix: string[] = [];
  if (crawl) {
    const st = crawl.stats as Record<string, any>;
    const opts = crawl.options as Record<string, any>;
    const issues = await db.issue.findMany({ where: { crawlId: crawl.id }, orderBy: { url: "asc" } });
    const viaLinks = (st.pages ?? 0) - Math.min(st.orphans ?? 0, 300);
    const hitLimit = st.limitReached ?? Boolean(opts.maxPages && viaLinks >= opts.maxPages);
    const orphanUrls = issues.filter((i) => i.code === "orphan").map((i) => i.url);
    const unverified = st.sitemapNotReached ?? orphanUrls.length;
    if (hitLimit && unverified)
      notes.push(`El crawl llegó al límite de ${opts.maxPages} páginas: ${pl(unverified, "URL")} del sitemap no se alcanzaron a recorrer, así que no se puede saber si son huérfanas. No se generan tareas de huérfanas; repetir con un máximo mayor.`);
    // menú/footer armado con JavaScript: páginas de primer nivel "huérfanas" o una home casi sin links en el HTML
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
        `Páginas que normalmente se enlazan desde el menú o el footer aparecen como huérfanas${topLevelOrphans.length ? ` (${topLevelOrphans.slice(0, 4).map((u) => `\`${new URL(u).pathname}\``).join(", ")}…)` : ""}${home && home.outlinks < 10 ? ` y la home tiene solo ${home.outlinks} links en el HTML` : ""}: probablemente el menú se arma con JavaScript. Repetir el crawl con **render JS** activado para confirmarlo.`
      );
    if (st.wafAborted) notes.push("El crawl se cortó porque el WAF bloqueó demasiadas páginas seguidas.");

    auditOut.push(
      `Crawl del ${date(crawl.startedAt)} · máx ${opts.maxPages ?? "–"} páginas${opts.render ? " · render JS" : ""}\n`,
      table(
        ["Salud técnica", "URLs", "Errores HTTP", "Redirects", "Huérfanas", "En sitemap", "Resp. media", "Errores", "Advertencias", "Observaciones"],
        [[st.health, st.pages, st.errors, st.redirects, st.orphans, st.sitemap, `${st.avgMs} ms`, st.critical, st.warning, st.info]]
      )
    );
    if (st.trapPatterns?.length) auditOut.push(`\nPatrones de URL recortados (posibles trampas de crawl): ${st.trapPatterns.map((t: any) => `\`${t.pattern}\` (${t.skipped})`).join(", ")}`);

    // falsos positivos → "parece intencional"
    const paramCanon = issues.filter((i) => i.code === "canonical_other" && isParamCanonical(i.url, i.detail || pageByKey.get(urlKey(i.url))?.canonical));
    const pathOf = (u: string) => {
      try {
        return new URL(u).pathname + "/";
      } catch {
        return u;
      }
    };
    const privateBlocked = issues.filter((i) => i.code === "blocked_robots" && PRIVATE_PATH.test(pathOf(i.url)));
    const skip = new Set([...paramCanon, ...privateBlocked].map((i) => i.id));
    if (paramCanon.length) intentional.push(`- **Canonical a otra URL** en ${pl(paramCanon.length, "URL")} con parámetros que apuntan a su versión sin parámetros (correcto). Ej.: ${paramCanon.slice(0, 3).map((i) => i.url).join(" · ")}`);
    if (privateBlocked.length) intentional.push(`- **Bloqueadas por robots** ${pl(privateBlocked.length, "URL")} de login/cuenta/carrito/checkout (correcto). Ej.: ${privateBlocked.slice(0, 3).map((i) => i.url).join(" · ")}`);

    const real = issues.filter((i) => !skip.has(i.id) && !(i.code === "orphan" && hitLimit));
    const byCode = new Map<string, typeof real>();
    for (const i of real) byCode.set(i.code, [...(byCode.get(i.code) ?? []), i]);
    const codes = [...byCode.entries()].sort((a, b) => SEV_ORDER.indexOf(a[1][0].severity as any) - SEV_ORDER.indexOf(b[1][0].severity as any) || b[1].length - a[1].length);
    auditOut.push(
      "\n" +
        table(
          ["Severidad", "Issue", "URLs", "Secciones más afectadas"],
          codes.map(([code, list]) => [SEV_LABEL[list[0].severity], ISSUE_LABELS[code] ?? code, list.length, topSections(list.map((i) => i.url)).map(([s, n]) => `${s} (${n})`).join(", ")])
        )
    );
    // hallazgos: un problema por plantilla (causa raíz), no uno por URL; misma lógica que la pantalla de Auditoría
    const pagesFull = await db.page.findMany({ where: { crawlId: crawl.id }, select: { url: true, status: true, depth: true, inlinks: true, jsonldTypes: true, error: true, canonical: true } });
    const ins = buildFindings(pagesFull, real, { cms: (st.cms as Cms) ?? null, hitLimit });
    patterns.push(...ins.patterns);
    for (const f of ins.findings) {
      const where = f.scope === "site" || f.scope === "layout" ? "todo el sitio" : f.scope === "scattered" ? "varias secciones" : `\`${f.template}\``;
      const tr = f.scope === "site" ? siteTraffic() : trafficOf(f.urls);
      if (f.rootCause) rootCauses.push(`- **${f.label}** — ${f.summary}`);
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
        })
      );
    }
    for (const [code, list] of codes)
      appendix.push(
        `### ${ISSUE_LABELS[code] ?? code} (${list.length})\n`,
        ...list.slice(0, MAX_URLS).map((i) => `- ${i.url}${i.detail ? ` — ${i.detail}` : ""}`),
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
      ? `usuarios reales: LCP ${f0(fld?.lcp?.p75)} ms, INP ${f0(fld?.inp?.p75)} ms, CLS ${fld?.cls?.p75 ?? "–"}`
      : v.hasField
        ? `laboratorio ${r.score}/100 pero los usuarios reales están bien`
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
    const tr = hasGsc ? { traffic: notIndexed.reduce((s, r) => s + weight(r.url), 0) * 10, label: `${notIndexed.length} URLs importantes` } : trafficOf(notIndexed.map((r) => r.url));
    tasks.push(makeTask({ title: `No indexadas según Google (${notIndexed.length} de las URLs principales)`, fix: "Revisar el estado de cobertura de cada una (sección Indexación): noindex, canonical, bloqueo o calidad.", traffic: tr.traffic, trafficLabel: tr.label, sev: 3, sevLabel: "crítico", ease: 0.6 }));
  }
  if (canonMismatch.length) {
    const tr = trafficOf(canonMismatch.map((r) => r.url));
    tasks.push(makeTask({ title: `Google eligió otro canonical (${canonMismatch.length} URLs)`, fix: "Unificar contenido/canonical para que coincidan con lo que Google elige.", traffic: tr.traffic, trafficLabel: tr.label, sev: 2, sevLabel: "warning", ease: 0.8 }));
  }

  // ---------- Search Console ----------
  const gscOut: string[] = [];
  if (gscEnd && d28) {
    const qp = await db.gscRow.groupBy({ by: ["query", "page"], where: { projectId, date: { gte: d28 } }, _sum: { clicks: true, impressions: true }, _avg: { position: true } });
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
          })
        );
      }
    }

    // Top consultas
    const q = await db.gscRow.groupBy({ by: ["query"], where: { projectId, date: { gte: d28 } }, _sum: { clicks: true, impressions: true }, _avg: { position: true } });
    const topQ = [...q].sort((a, b) => (b._sum.clicks ?? 0) - (a._sum.clicks ?? 0)).slice(0, 20);
    gscOut.push("\n**Top consultas**\n", table(["Consulta", "Clicks", "Impr.", "Pos.", "Marca"], topQ.map((r) => [r.query, f0(r._sum.clicks), f0(r._sum.impressions), f1(r._avg.position), isBrandQuery(r.query, brand) ? "sí" : ""])));

    // Páginas que perdieron clics, por plantilla
    const d56 = new Date(gscEnd.getTime() - 55 * 864e5);
    const pg = (from: Date, to: Date) => db.gscRow.groupBy({ by: ["page"], where: { projectId, date: { gte: from, lt: to } }, _sum: { clicks: true } });
    const [pc, pp] = await Promise.all([pg(d28, new Date(gscEnd.getTime() + 864e5)), pg(d56, d28)]);
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
        })
      );
    }
  } else {
    kwOut.push(emptyText(mod("keywords")));
  }

  // ---------- Contenido (entra en la priorización como cualquier tarea) ----------
  const contents = await db.contentAnalysis.findMany({ where: { projectId, status: "done" }, orderBy: { createdAt: "desc" }, take: 10 });
  const contentOut: string[] = [];
  for (const c of contents) {
    const r = c.result as any;
    const b = c.brief as any;
    const missing = (r.terms ?? []).filter((t: any) => t.missing).slice(0, 12).map((t: any) => t.term);
    const unanswered = (r.paa ?? []).filter((x: any) => !x.answered).map((x: any) => x.q);
    const typeLabel: Record<string, string> = { listing: "listado", detail: "ficha", article: "artículo", home: "home" };
    contentOut.push(
      `### ${c.keyword} → ${c.url} · score ${c.score ?? "–"}/100\n`,
      r.pageType ? `- Google muestra: ${typeLabel[r.pageType] ?? r.pageType}s${r.mine?.type && r.mine.type !== r.pageType ? ` (la página es ${typeLabel[r.mine.type]})` : ""}` : "",
      `- Palabras editoriales: ${r.mine?.editorial ?? r.mine?.words ?? "–"} (objetivo ~${r.targetWords ?? "–"})`,
      r.target?.mismatch ? `- ⚠ Para «${c.keyword}» Google ya muestra ${r.target.gscUrl}: optimizar esa o diferenciar (riesgo de canibalización)` : "",
      missing.length ? `- Términos faltantes: ${missing.join(", ")}` : "",
      unanswered.length ? `- Preguntas sin responder: ${unanswered.join(" · ")}` : "",
      b?.titles?.length ? `- Titles sugeridos: ${b.titles.slice(0, 3).map((t: string) => `"${t}"`).join(" · ")}` : "",
      b?.kind === "listing" && b?.intro ? `- Intro del listado: ${b.intro}` : "",
      b?.kind === "listing" && b?.filters?.length ? `- Filtros: ${b.filters.join(", ")}` : "",
      b?.kind !== "listing" && b?.outline?.length ? `- Outline sugerido:\n${b.outline.map((o: any) => `  ${o.tag === "h3" ? "  " : ""}- ${o.tag.toUpperCase()} ${o.text}`).join("\n")}` : "",
      ""
    );
    const score = c.score ?? 100;
    if (score < 75) {
      const kwImpr = hasGsc ? (await db.gscRow.aggregate({ where: { projectId, query: c.keyword.toLowerCase(), date: { gte: d28 ?? undefined } }, _sum: { impressions: true } }))._sum.impressions ?? 0 : 0;
      const kwVol = (await db.keyword.findFirst({ where: { projectId, term: c.keyword.toLowerCase() }, select: { volume: true } }))?.volume ?? 0;
      const urlTr = trafficOf([c.url]);
      const traffic = Math.max(urlTr.traffic, kwImpr, kwVol);
      tasks.push(
        makeTask({
          title: `Contenido de ${c.url} para «${c.keyword}» (score ${score}/100)`,
          fix: `Aplicar el brief de la sección Contenido${r.pageType === "listing" ? " (página de listado: intro corta, filtros y links internos)" : ""}${missing.length ? `; cubrir ${missing.slice(0, 5).join(", ")}` : ""}.`,
          traffic,
          trafficLabel: traffic === kwVol && kwVol > urlTr.traffic ? `${f0(kwVol)} búsquedas/mes` : traffic === kwImpr && kwImpr > 0 ? `${f0(kwImpr)} impr de la keyword` : urlTr.label,
          sev: score < 40 ? 3 : score < 60 ? 2 : 1,
          sevLabel: score < 40 ? "alto" : score < 60 ? "medio" : "bajo",
          ease: 0.6,
        })
      );
    }
  }

  // ---------- Armado ----------
  tasks.sort(byPriority);
  const top = tasks.slice(0, MAX_TASKS);
  const rest = tasks.slice(MAX_TASKS);
  const out: string[] = [];
  out.push(
    `# Informe SEO · ${site}`,
    "",
    `Generado ${date(new Date())} · país ${p.country.toUpperCase()} · idioma ${p.language}`,
    "",
    "> **Para el agente que edita el código:** este informe viene de un análisis externo del sitio en producción. Las tareas están ordenadas por impacto (tráfico afectado × severidad × facilidad). Para cada una, ubica en el repositorio la ruta/plantilla indicada (p. ej. `/perfil/*`) y corrige ahí, no URL por URL. No inventes datos de negocio; si un texto depende de datos reales, genéralo desde los campos existentes. Antes de cambiar redirects, canonicals o robots.txt, confirma que no se pierdan páginas indexadas.",
    ""
  );
  // qué datos respaldan este informe: "sin datos" no es lo mismo que "falló"
  out.push(
    "## Cobertura de datos",
    "",
    table(["Módulo", "Estado", "Detalle"], cov.map((m) => [m.label, `${m.state === "ok" ? "✓" : m.state === "failed" ? "✗" : m.state === "partial" ? "◐" : "–"} ${STATE_LABEL[m.state]}`, m.detail])),
    ...(cov.some((m) => m.state === "failed") ? ["", "> ⚠ Hay módulos cuyo último intento falló: lo que muestra este informe para ellos puede estar desactualizado o incompleto."] : []),
    ""
  );
  if (trends.length) out.push("## Tendencias", "", ...trends, "");
  if (notes.length) out.push("## Avisos", "", ...notes.map((n) => `- ${n}`), "");
  out.push(
    "## Tareas por impacto",
    "",
    `${hasGsc ? "_Tráfico = impresiones de Search Console (28 días) de las URLs afectadas." : "_Sin Search Console: el tráfico se estima con el peso de cada URL en el sitio (links entrantes, home)."} Los issues on-page menores (largo de title/meta, alt, H1 múltiple…) van al final aunque su impacto sea alto._`,
    "",
    top.length
      ? top.map((t, i) => `${i + 1}. **${t.title}** — ${t.fix}\n   _Impacto ${f0(t.score)} = ${t.trafficLabel} × ${t.sevLabel} × ${EASE_LABEL(t.ease)}${t.minor ? " · on-page menor" : ""}_`).join("\n")
      : "_Nada pendiente con los datos actuales._",
    ""
  );
  if (rest.length) out.push("### Tareas menores", "", table(["Tarea", "Impacto"], rest.map((t) => [t.title, f0(t.score)])), "");
  if (rootCauses.length || patterns.length)
    out.push(
      "## Causas raíz y patrones",
      "",
      "_Problemas que vienen de una plantilla o del layout: se corrigen una vez y arreglan todas sus URLs (el listado completo va en el anexo)._",
      "",
      ...rootCauses,
      ...patterns.map((x) => `- ${x.text}`),
      ""
    );
  if (intentional.length) out.push("## Revisado, parece intencional", "", "_No se generan tareas para esto; confirmar si no corresponde._", "", ...intentional, "");
  out.push("## Search Console", "", ...gscOut, "");
  out.push(
    "## Velocidad (PageSpeed)",
    "",
    ...(psiOut.length ? [...psiOut, ""] : []),
    !psiRows.length ? emptyText(mod("psi")) : table(
      ["URL", "Estrategia", "Score lab", "LCP lab ms", "Usuarios reales (campo)"],
      psiRows.map((r) => {
        const lab = r.lab as Record<string, number | null>;
        const fld = r.field as Record<string, any>;
        return [r.url, r.strategy, r.score ?? "–", f0(lab.lcp), fld?.source ? `${fld.source === "origin" ? "origen" : "URL"} · LCP ${f0(fld.lcp?.p75)} · INP ${f0(fld.inp?.p75)} · CLS ${fld.cls?.p75 ?? "–"}` : "sin datos"];
      })
    ),
    ""
  );
  out.push("## Auditoría técnica", "", ...auditOut, "");
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
  if (appendix.length) out.push("## Anexo: URLs por issue", "", `Hasta ${MAX_URLS} URLs por issue.`, "", ...appendix);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
