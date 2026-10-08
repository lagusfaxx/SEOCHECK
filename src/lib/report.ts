import { db } from "./db";
import { env } from "./env";
import { ISSUE_LABELS } from "./audit/issues";
import { ISSUE_FIX } from "./audit/fixes";
import { hostOf } from "./util";


const SEV_ORDER = ["critical", "warning", "info"] as const;
const SEV_LABEL: Record<string, string> = { critical: "Crítico", warning: "Warning", info: "Info" };
const MAX_URLS = 25;

/** Agrupa por sección del sitio (/perfil/*) para que se pueda ubicar la plantilla que genera la URL. */
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

/** Genera el informe completo del proyecto en Markdown, a partir de lo último guardado de cada módulo. */
export async function buildReport(projectId: string): Promise<string> {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const site = p.domain;
  const mine = (u: string) => hostOf(u) === hostOf(`https://${site}`) || hostOf(u).endsWith(`.${hostOf(`https://${site}`)}`);
  const out: string[] = [];
  const tasks: string[] = [];
  const notes: string[] = [];

  // ---------- Auditoría ----------
  const crawl = await db.crawl.findFirst({ where: { projectId, status: "done" }, orderBy: { startedAt: "desc" } });
  const auditOut: string[] = [];
  const appendix: string[] = [];
  if (crawl) {
    const st = crawl.stats as Record<string, any>;
    const opts = crawl.options as Record<string, any>;
    const issues = await db.issue.findMany({ where: { crawlId: crawl.id }, orderBy: { url: "asc" } });
    const viaLinks = (st.pages ?? 0) - Math.min(st.orphans ?? 0, 300);
    const hitLimit = opts.maxPages && viaLinks >= opts.maxPages;
    if (hitLimit && st.orphans) notes.push(`El crawl llegó al límite de ${opts.maxPages} páginas: las "huérfanas" pueden ser solo páginas que no alcanzó a recorrer. Repetir con un máximo mayor antes de corregir huérfanas.`);
    if (st.wafAborted) notes.push("El crawl se cortó porque el WAF bloqueó demasiadas páginas seguidas.");

    auditOut.push(
      `Crawl del ${date(crawl.startedAt)} · máx ${opts.maxPages ?? "–"} páginas\n`,
      table(
        ["Salud", "URLs", "Errores", "Redirects", "Huérfanas", "En sitemap", "Resp. media", "Críticos", "Warnings", "Info"],
        [[st.health, st.pages, st.errors, st.redirects, st.orphans, st.sitemap, `${st.avgMs} ms`, st.critical, st.warning, st.info]]
      )
    );
    if (st.trapPatterns?.length) auditOut.push(`\nPatrones de URL recortados (posibles trampas de crawl): ${st.trapPatterns.map((t: any) => `\`${t.pattern}\` (${t.skipped})`).join(", ")}`);

    const byCode = new Map<string, typeof issues>();
    for (const i of issues) byCode.set(i.code, [...(byCode.get(i.code) ?? []), i]);
    const codes = [...byCode.entries()].sort(
      (a, b) => SEV_ORDER.indexOf(a[1][0].severity as any) - SEV_ORDER.indexOf(b[1][0].severity as any) || b[1].length - a[1].length
    );
    auditOut.push(
      "\n" +
        table(
          ["Severidad", "Issue", "URLs", "Secciones más afectadas"],
          codes.map(([code, list]) => [SEV_LABEL[list[0].severity], ISSUE_LABELS[code] ?? code, list.length, topSections(list.map((i) => i.url)).map(([s, n]) => `${s} (${n})`).join(", ")])
        )
    );
    for (const [code, list] of codes) {
      const urls = [...new Set(list.map((i) => i.url))];
      const secs = topSections(urls, 3).map(([s, n]) => `\`${s}\` ${n}`).join(", ");
      const orphanNote = code === "orphan" && hitLimit ? " ⚠ verificar con un crawl completo antes de actuar." : "";
      tasks.push(`- [ ] **${ISSUE_LABELS[code] ?? code}** · ${SEV_LABEL[list[0].severity]} · ${urls.length} URL${urls.length === 1 ? "" : "s"} (${secs}). ${ISSUE_FIX[code] ?? ""}${orphanNote}`);
      appendix.push(
        `### ${ISSUE_LABELS[code] ?? code} (${list.length})\n`,
        ...list.slice(0, MAX_URLS).map((i) => `- ${i.url}${i.detail ? ` — ${i.detail}` : ""}`),
        ...(list.length > MAX_URLS ? [`- … y ${list.length - MAX_URLS} más`] : []),
        ""
      );
    }
  } else {
    auditOut.push("_Sin crawl terminado._");
  }

  // ---------- Velocidad ----------
  const psi = await db.psiResult.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 200 });
  const psiLatest = new Map<string, (typeof psi)[number]>();
  for (const r of psi) if (!psiLatest.has(`${r.url}|${r.strategy}`)) psiLatest.set(`${r.url}|${r.strategy}`, r);
  const psiRows = [...psiLatest.values()].sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  for (const r of psiRows) {
    const lab = r.lab as Record<string, number | null>;
    if (r.score != null && r.score < 50) tasks.push(`- [ ] **PageSpeed ${r.strategy} ${r.score}/100** en ${r.url} (LCP ${f0(lab.lcp)} ms, CLS ${lab.cls?.toFixed(2) ?? "–"}): optimizar imágenes/JS que bloquean el render.`);
  }

  // ---------- Indexación ----------
  const insp = await db.urlInspection.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 500 });
  const inspLatest = new Map<string, (typeof insp)[number]>();
  for (const r of insp) if (!inspLatest.has(r.url)) inspLatest.set(r.url, r);
  const notIndexed = [...inspLatest.values()].filter((r) => r.verdict && r.verdict !== "PASS");
  const canonMismatch = [...inspLatest.values()].filter((r) => r.googleCanonical && r.userCanonical && r.googleCanonical !== r.userCanonical);
  if (notIndexed.length) tasks.push(`- [ ] **No indexadas según Google** · ${notIndexed.length} URLs inspeccionadas (ver sección Indexación): revisar el estado de cobertura de cada una.`);
  if (canonMismatch.length) tasks.push(`- [ ] **Google eligió otro canonical** · ${canonMismatch.length} URLs: unificar contenido/canonical para que coincidan.`);

  // ---------- Search Console ----------
  const gscOut: string[] = [];
  const lastGsc = await db.gscRow.findFirst({ where: { projectId }, orderBy: { date: "desc" }, select: { date: true } });
  if (lastGsc) {
    const end = lastGsc.date;
    const d28 = new Date(end.getTime() - 27 * 864e5);
    const d56 = new Date(end.getTime() - 55 * 864e5);
    const [cur, prev] = await Promise.all([
      db.gscRow.aggregate({ where: { projectId, date: { gte: d28, lte: end } }, _sum: { clicks: true, impressions: true } }),
      db.gscRow.aggregate({ where: { projectId, date: { gte: d56, lt: d28 } }, _sum: { clicks: true, impressions: true } }),
    ]);
    const ck = cur._sum.clicks ?? 0, im = cur._sum.impressions ?? 0, pck = prev._sum.clicks ?? 0, pim = prev._sum.impressions ?? 0;
    gscOut.push(
      `Últimos 28 días hasta ${end.toISOString().slice(0, 10)} vs 28 días anteriores\n`,
      table(["", "Clicks", "Impresiones", "CTR"], [["Actual", f0(ck), f0(im), pctS(im ? ck / im : null)], ["Anterior", f0(pck), f0(pim), pctS(pim ? pck / pim : null)]])
    );

    const q = await db.gscRow.groupBy({ by: ["query"], where: { projectId, date: { gte: d28 } }, _sum: { clicks: true, impressions: true }, _avg: { position: true } });
    const topQ = [...q].sort((a, b) => (b._sum.clicks ?? 0) - (a._sum.clicks ?? 0)).slice(0, 20);
    gscOut.push("\n**Top consultas**\n", table(["Consulta", "Clicks", "Impr.", "Pos."], topQ.map((r) => [r.query, f0(r._sum.clicks), f0(r._sum.impressions), f1(r._avg.position)])));

    // casi en primera página: posición 4–20 con impresiones
    const qp = await db.gscRow.groupBy({ by: ["query", "page"], where: { projectId, date: { gte: d28 } }, _sum: { clicks: true, impressions: true }, _avg: { position: true } });
    const striking = qp
      .filter((r) => (r._avg.position ?? 99) >= 4 && (r._avg.position ?? 99) <= 20 && (r._sum.impressions ?? 0) >= 30)
      .sort((a, b) => (b._sum.impressions ?? 0) - (a._sum.impressions ?? 0))
      .slice(0, 30);
    gscOut.push(
      "\n**Oportunidades: posición 4–20 con impresiones** (mejorar la página que ya rankea)\n",
      table(["Consulta", "Página", "Impr.", "Clicks", "Pos."], striking.map((r) => [r.query, r.page, f0(r._sum.impressions), f0(r._sum.clicks), f1(r._avg.position)]))
    );
    if (striking.length)
      tasks.push(`- [ ] **Consultas en posición 4–20** · ${striking.length} (ver Search Console): en cada página, incluir la consulta en title/H1/H2, ampliar el contenido sobre ese tema y sumar links internos con ese anchor.`);

    const pg = (from: Date, to: Date) => db.gscRow.groupBy({ by: ["page"], where: { projectId, date: { gte: from, lt: to } }, _sum: { clicks: true } });
    const [pc, pp] = await Promise.all([pg(d28, new Date(end.getTime() + 864e5)), pg(d56, d28)]);
    const prevMap = new Map(pp.map((r) => [r.page, r._sum.clicks ?? 0]));
    const drops = pc
      .map((r) => ({ page: r.page, now: r._sum.clicks ?? 0, before: prevMap.get(r.page) ?? 0 }))
      .concat(pp.filter((r) => !pc.some((c) => c.page === r.page)).map((r) => ({ page: r.page, now: 0, before: r._sum.clicks ?? 0 })))
      .filter((r) => r.before - r.now >= 5)
      .sort((a, b) => b.before - b.now - (a.before - a.now))
      .slice(0, 15);
    gscOut.push("\n**Páginas que perdieron clicks**\n", table(["Página", "Antes", "Ahora", "Δ"], drops.map((r) => [r.page, r.before, r.now, r.now - r.before])));
    if (drops.length) tasks.push(`- [ ] **Páginas con caída de clicks** · ${drops.length} (ver Search Console): revisar cambios recientes, estado HTTP, indexación y contenido.`);
  } else {
    gscOut.push(p.gscProperty ? "_Sin datos sincronizados._" : "_Sin propiedad de Search Console configurada._");
  }

  // ---------- Alertas ----------
  const alerts = await db.alert.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 60 });
  const cannibal = alerts.filter((a) => a.type === "cannibal");
  const lowctr = alerts.filter((a) => a.type === "lowctr");
  const dropsRank = alerts.filter((a) => a.type === "drop");
  const alertOut: string[] = [];
  if (cannibal.length) {
    alertOut.push("**Canibalización** (varias URLs compiten por la misma consulta)\n");
    for (const a of cannibal.slice(0, 20)) {
      const d = a.data as any;
      const pages: string[] = d.pages?.map((x: any) => `${x.page} (${f0(x.impressions)} impr, pos ${f1(x.position)})`) ?? d.urls ?? [];
      alertOut.push(`- **${a.key}**: ${pages.join(" · ")}`);
    }
    tasks.push(`- [ ] **Canibalización** · ${cannibal.length} consultas: elegir una URL principal por consulta, diferenciar el enfoque de las otras o consolidarlas con 301/canonical.`);
  }
  if (lowctr.length) {
    alertOut.push("\n**CTR bajo para su posición** (reescribir title y meta)\n");
    for (const a of lowctr.slice(0, 20)) {
      const d = a.data as any;
      alertOut.push(`- **${a.key}** · ${d.page} · ${f0(d.impressions)} impr · CTR ${pctS(d.ctr)} (esperado ${pctS(d.expected)}) · pos ${f1(d.position)}`);
    }
    tasks.push(`- [ ] **CTR bajo** · ${lowctr.length} consultas: reescribir title y meta description de esas páginas para que respondan a la consulta.`);
  }
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
    const rows = clusters.map((c) => {
      const own = c.urls.find(mine);
      return [c.topic?.name ?? "–", c.name, c.primary, f0(c.volume), c.intent ?? "–", c._count.keywords, own ? `optimizar ${own}` : "crear página"];
    });
    kwOut.push(table(["Topic", "Cluster", "Keyword principal", "Volumen", "Intención", "KWs", "Acción"], rows));
    const gaps = clusters.filter((c) => !c.urls.some(mine) && c.volume > 0).slice(0, 15);
    if (gaps.length)
      tasks.push(`- [ ] **Clusters sin página propia** · ${gaps.length}: crear una landing por cluster (${gaps.slice(0, 6).map((c) => `"${c.primary}"`).join(", ")}${gaps.length > 6 ? ", …" : ""}). Una URL por cluster; las keywords del cluster van en H2/texto.`);
  } else {
    kwOut.push("_Sin research de keywords terminado._");
  }

  // ---------- Contenido ----------
  const contents = await db.contentAnalysis.findMany({ where: { projectId, status: "done" }, orderBy: { createdAt: "desc" }, take: 10 });
  const contentOut: string[] = [];
  for (const c of contents) {
    const r = c.result as any;
    const b = c.brief as any;
    const missing = (r.terms ?? []).filter((t: any) => t.missing).slice(0, 12).map((t: any) => t.term);
    const unanswered = (r.paa ?? []).filter((x: any) => !x.answered).map((x: any) => x.q);
    contentOut.push(
      `### ${c.keyword} → ${c.url} · score ${c.score ?? "–"}/100\n`,
      `- Palabras: ${r.mine?.words ?? "–"} (objetivo ~${r.targetWords ?? "–"})`,
      missing.length ? `- Términos faltantes: ${missing.join(", ")}` : "",
      unanswered.length ? `- Preguntas sin responder: ${unanswered.join(" · ")}` : "",
      b?.titles?.length ? `- Titles sugeridos: ${b.titles.slice(0, 3).map((t: string) => `"${t}"`).join(" · ")}` : "",
      b?.outline?.length ? `- Outline sugerido:\n${b.outline.map((o: any) => `  ${o.tag === "h3" ? "  " : ""}- ${o.tag.toUpperCase()} ${o.text}`).join("\n")}` : "",
      ""
    );
    if ((c.score ?? 100) < 60) tasks.push(`- [ ] **Contenido bajo (${c.score}/100)** en ${c.url} para "${c.keyword}": aplicar el brief de la sección Contenido.`);
  }

  // ---------- Armado ----------
  out.push(
    `# Informe SEO · ${site}`,
    "",
    `Generado ${date(new Date())} · país ${p.country.toUpperCase()} · idioma ${p.language}`,
    "",
    "> **Para el agente que edita el código:** este informe viene de un análisis externo del sitio en producción. Para cada tarea, ubica en el repositorio la ruta/plantilla que genera la sección indicada (p. ej. `/perfil/*`) y corrige ahí, no URL por URL. Respeta el orden de prioridad. No inventes datos de negocio; si un texto depende de datos reales, genéralo desde los campos existentes. Antes de cambiar redirects, canonicals o robots.txt, confirma que no se pierdan páginas indexadas.",
    ""
  );
  if (notes.length) out.push("## Avisos", "", ...notes.map((n) => `- ${n}`), "");
  out.push("## Tareas (por prioridad)", "", tasks.length ? tasks.join("\n") : "_Nada pendiente con los datos actuales._", "");
  out.push("## Auditoría técnica", "", ...auditOut, "");
  out.push(
    "## Velocidad (PageSpeed)",
    "",
    table(
      ["URL", "Estrategia", "Score", "LCP ms", "CLS", "TBT ms", "Datos de campo"],
      psiRows.map((r) => {
        const lab = r.lab as Record<string, number | null>;
        const fld = r.field as Record<string, any>;
        return [r.url, r.strategy, r.score ?? "–", f0(lab.lcp), lab.cls?.toFixed(2) ?? "–", f0(lab.tbt), fld?.source ? `${fld.source} · LCP ${f0(fld.lcp?.p75)} · INP ${f0(fld.inp?.p75)}` : "sin datos"];
      })
    ),
    ""
  );
  out.push(
    "## Indexación (URL Inspection)",
    "",
    inspLatest.size
      ? table(["URL", "Veredicto", "Cobertura", "Canonical Google", "Canonical declarado", "Último rastreo"], [...inspLatest.values()].map((r) => [r.url, r.verdict, r.coverageState, r.googleCanonical, r.userCanonical, r.lastCrawl?.toISOString().slice(0, 10)]))
      : "_Sin inspecciones._",
    ""
  );
  out.push("## Search Console", "", ...gscOut, "");
  if (alertOut.length) out.push("## Alertas", "", ...alertOut, "");
  out.push(
    "## Rankings",
    "",
    rankRows.length ? table(["Keyword", "Pos.", "Anterior", "URL", "Revisado"], rankRows.map((r) => [r.k, r.pos ?? (r.at ? ">100" : "–"), r.prev ?? "–", r.url, r.at?.toISOString().slice(0, 10)])) : "_Sin keywords trackeadas._",
    ""
  );
  out.push("## Keywords y clusters", "", ...kwOut, "");
  if (contentOut.length) out.push("## Contenido", "", ...contentOut.filter((l) => l !== ""), "");
  if (appendix.length) out.push("## Anexo: URLs por issue", "", `Hasta ${MAX_URLS} URLs por issue.`, "", ...appendix);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
