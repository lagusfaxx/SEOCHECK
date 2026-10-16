import path from "node:path";
import PDFDocument from "pdfkit";
import { db } from "./db";
import { buildReport } from "./report";
import { projectActions } from "./tasks";
import { withProjectQuota, projectPlan } from "./plans";
import { issueIdentity } from "./task-rules";
import { detailText, ISSUE_LABELS } from "./audit/issues";
import { DEFAULT_VERIFY, ISSUE_FIX, ISSUE_VERIFY, ISSUE_WHY } from "./audit/fixes";
import { coverage } from "./coverage";
import { gscPeriod, isoDay, periodLabel, SOURCE_NOTE } from "./gsc-period";
import { KIND_LABEL, kindOf, splitIntentional } from "./audit/insights";

export async function auditComparison(projectId: string) {
  const crawls = await db.crawl.findMany({
    where: { projectId, status: { in: ["completed", "partial"] } },
    orderBy: { startedAt: "desc" },
    take: 2,
    include: {
      issues: true,
      pages: {
        select: { url: true, status: true, error: true, blocked: true },
      },
    },
  });
  const [now, prev] = crawls;
  if (!now) return null;
  const current = new Set(now.issues.map((i) => issueIdentity(i.code, i.url)));
  const old = new Set(
    prev?.issues.map((i) => issueIdentity(i.code, i.url)) ?? [],
  );
  const observed = new Set(
    now.pages
      .filter((p) => p.status === 200 && !p.error && !p.blocked)
      .map((p) => p.url),
  );
  const resolved =
    prev && now.status === "completed"
      ? prev.issues.filter(
          (i) =>
            !current.has(issueIdentity(i.code, i.url)) && observed.has(i.url),
        ).length
      : null;
  const stats = now.stats as Record<string, any>,
    before = prev?.stats as Record<string, any> | undefined;
  return {
    currentId: now.id,
    previousId: prev?.id ?? null,
    currentAt: now.finishedAt,
    previousAt: prev?.finishedAt ?? null,
    health: stats.health ?? null,
    previousHealth: before?.health ?? null,
    new: prev ? [...current].filter((k) => !old.has(k)).length : null,
    resolved,
    total: current.size,
    partial: now.status === "partial",
    comparable: !!prev && now.status === "completed",
    pages: now.pages.length,
  };
}
export async function executiveReport(projectId: string) {
  // mismo período que el informe técnico: 28 días hasta el último día con datos de Search Console
  const period = await gscPeriod(projectId);
  const inPeriod = period ? { gte: period.start, lt: period.endExclusive } : undefined;
  const [p, comparison, actions, plan, gscDays, gscRows] = await Promise.all([
    db.project.findUniqueOrThrow({ where: { id: projectId } }),
    auditComparison(projectId),
    projectActions(projectId),
    projectPlan(projectId),
    period ? db.gscDay.aggregate({ where: { projectId, date: inPeriod }, _sum: { clicks: true, impressions: true }, _count: true }) : null,
    period ? db.gscRow.aggregate({ where: { projectId, date: inPeriod }, _sum: { clicks: true, impressions: true } }) : null,
  ]);
  // totales del sitio si están; si no, la suma de filas (que excluye consultas anonimizadas), y se dice cuál es
  const totals = Boolean(gscDays?._count);
  const gsc = totals ? gscDays! : gscRows;
  const branding = plan.limits.whiteLabel
    ? (plan.workspace.branding as Record<string, any>)
    : {};
  const [allIssues, crawlPages, sources, queries, speed] = await Promise.all([
    comparison
      ? db.issue.findMany({ where: { crawlId: comparison.currentId } })
      : [],
    comparison
      ? db.page.findMany({ where: { crawlId: comparison.currentId }, select: { url: true, status: true, depth: true, error: true, canonical: true } })
      : [],
    coverage(projectId),
    db.gscRow.groupBy({
      by: ["query"],
      where: { projectId, date: inPeriod ?? { gte: new Date() } },
      _sum: { clicks: true, impressions: true },
      _avg: { position: true },
      orderBy: { _sum: { impressions: "desc" } },
      take: 10,
    }),
    db.psiResult.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);
  // lo intencional (variantes por color, filtros con noindex, cuenta/carrito) no se presenta como problema
  const crawlStats = comparison ? ((await db.crawl.findUnique({ where: { id: comparison.currentId }, select: { stats: true } }))?.stats as Record<string, any>) : {};
  const split = splitIntentional(allIssues, crawlPages, { hitLimit: Boolean(crawlStats?.limitReached) });
  const issues = allIssues.filter((i) => split.real.includes(i));
  const grouped = new Map<
    string,
    {
      code: string;
      title: string;
      severity: string;
      count: number;
      kind: string;
      why: string;
      fix: string;
      verify: string;
      urls: string[];
      evidence: string[];
    }
  >();
  for (const i of issues) {
    const g = grouped.get(i.code) ?? {
      code: i.code,
      title: ISSUE_LABELS[i.code] ?? i.code,
      severity: i.severity,
      count: 0,
      kind: KIND_LABEL[kindOf(i.code)],
      verify: ISSUE_VERIFY[i.code] ?? DEFAULT_VERIFY,
      why:
        ISSUE_WHY[i.code] ??
        "Revisar el efecto sobre rastreo, indexación y presentación en Google.",
      fix:
        ISSUE_FIX[i.code] ??
        "Revisar la evidencia en la URL y corregir la causa antes de repetir la auditoría.",
      urls: [],
      evidence: [],
    };
    g.count++;
    // evidencia = URL + valor observado, juntos: un "4xx" sin su URL no se puede corregir
    if (g.urls.length < 5 && !g.urls.includes(i.url)) {
      g.urls.push(i.url);
      g.evidence.push(i.detail ? `${i.url} — ${detailText(i.code, i.detail)}` : i.url);
    }
    grouped.set(i.code, g);
  }
  const weight: Record<string, number> = { critical: 3, warning: 2, info: 1 };
  const KIND_ORDER = [KIND_LABEL.confirmed, KIND_LABEL.possible, KIND_LABEL.opportunity];
  return {
    project: p.name,
    domain: p.domain,
    generatedAt: new Date().toISOString(),
    comparison,
    // acciones de la MISMA auditoría que las tablas: con su evidencia actual (URL + valor observado)
    actions: actions.actions.map((t) => ({
      kind: t.source === "crawl" && t.code ? KIND_LABEL[kindOf(t.code)] : null,
      evidence:
        t.source === "crawl"
          ? (t.members ?? [])
              .filter((m: any) => m.lastCrawlId === comparison?.currentId && !["resolved", "ignored"].includes(m.status))
              .slice(0, 3)
              .map((m: any) => {
                const d = allIssues.find((i) => i.code === m.code && i.url === m.url)?.detail;
                return `${m.url}${d ? ` — ${detailText(m.code ?? "", d)}` : ""}`;
              })
          : [],
      title: t.title,
      reason: t.reason,
      affected: t.affected,
      category: t.category,
      priorityLabel: t.priorityLabel,
      pattern: t.pattern,
      fix: t.fix,
      url: t.url,
      status: t.status,
    })),
    improved: actions.improved.length,
    traffic: {
      clicks: gsc?._sum.clicks ?? null,
      impressions: gsc?._sum.impressions ?? null,
      period: period ? { start: isoDay(period.start), end: isoDay(period.end), label: periodLabel(period, totals ? "totals" : "rows") } : null,
      source: totals ? "totals" : "rows",
    },
    intentional: split.intentional.map((x) => ({ text: x.text, examples: x.examples })),
    branding,
    findings: [...grouped.values()].sort(
      (a, b) =>
        // primero lo confirmado, después hipótesis y al final mejoras opcionales; dentro, por severidad
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        (weight[b.severity] ?? 0) - (weight[a.severity] ?? 0) ||
        b.count - a.count,
    ),
    crawledAt: comparison?.currentAt?.toISOString() ?? null,
    sources,
    queries: queries.map((q) => ({
      query: q.query,
      clicks: q._sum.clicks ?? 0,
      impressions: q._sum.impressions ?? 0,
      position: q._avg.position,
    })),
    speed: [
      ...new Map(
        speed.map((s) => [`${s.url}:${s.strategy}`, s] as const).reverse(),
      ).values(),
    ].map((s) => ({
      url: s.url,
      strategy: s.strategy,
      score: s.score,
      lab: s.lab,
      field: s.field,
      date: s.createdAt.toISOString(),
    })),
  };
}
export type ExecutiveReport = Awaited<ReturnType<typeof executiveReport>>;
export async function saveReport(projectId: string) {
  const [executive, markdown] = await Promise.all([
    executiveReport(projectId),
    buildReport(projectId),
  ]);
  const saved = await withProjectQuota(projectId, "reports", 1, (tx) =>
    tx.reportSnapshot.create({
      data: { projectId, executive: executive as any, markdown },
    }),
  );
  await import("./pro/notifications").then(n => n.queueNotice(projectId, "report.ready", `report:${saved.id}`, { message: "Informe SEO actualizado", reportId: saved.id })).catch(e => console.warn("[notifications]", e));
  return saved;
}
export function executivePdf(
  r: ExecutiveReport,
  technicalMarkdown?: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      bufferPages: true,
      info: {
        Title: `Informe SEO · ${r.project}`,
        Author: r.branding.name || "FSV Search",
      },
    });
    doc.registerFont(
      "ReportRegular",
      path.join(process.cwd(), "src/assets/fonts/OpenSans-Regular.ttf"),
    );
    doc.registerFont(
      "ReportBold",
      path.join(process.cwd(), "src/assets/fonts/OpenSans-Bold.ttf"),
    );
    doc.font("ReportRegular");
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const color = /^#[0-9a-f]{6}$/i.test(r.branding.color ?? "")
      ? r.branding.color
      : "#5151db";
    if (
      typeof r.branding.logo === "string" &&
      /^data:image\/(png|jpeg);base64,/.test(r.branding.logo)
    ) {
      try {
        doc.image(
          Buffer.from(r.branding.logo.split(",")[1], "base64"),
          48,
          40,
          { fit: [100, 48] },
        );
        doc.moveDown(3);
      } catch {
        /* a missing logo must not break the report */
      }
    }
    doc
      .fillColor(color)
      .fontSize(24)
      .text(r.branding.name || "FSV Search");
    doc
      .fillColor("#222222")
      .fontSize(18)
      .text(
        technicalMarkdown ? "Informe técnico SEO" : "Informe ejecutivo SEO",
      );
    doc
      .fontSize(12)
      .text(`${r.project} · ${r.domain}`)
      .text(
        new Date(r.generatedAt).toLocaleDateString("es-CL", {
          timeZone: "America/Santiago",
        }),
      );
    if (r.branding.contact) doc.fontSize(10).text(r.branding.contact);
    doc.moveDown();
    const c = r.comparison;
    doc.fontSize(15).text("Estado del sitio");
    doc.fontSize(11);
    doc.text(
      c
        ? `Salud técnica del rastreo: ${c.health ?? "sin datos"}/100${c.previousId ? ` (anterior: ${c.previousHealth ?? "sin datos"})` : " (primera auditoría)"}. ${c.pages} ${c.pages === 1 ? "URL auditada" : "URLs auditadas"}.`
        : "Todavía no hay una auditoría terminada.",
    );
    // la salud solo mide el rastreo: decir qué quedó sin medir para no presentar 100/100 como "todo bien"
    const unmeasured = (r.sources ?? []).filter((s) => s.state !== "ok").map((s) => s.label);
    if (c && unmeasured.length) doc.fillColor("#9a3412").text(`Sin medir en esta versión: ${unmeasured.join(", ")}. La salud no incluye esas áreas.`).fillColor("#222222");
    if (c?.previousId)
      doc.text(
        `${c.new ?? "—"} incidencias nuevas. ${c.resolved ?? "No confirmado"} solucionadas.${c.partial ? " Auditoría parcial: no se confirma la desaparición de problemas." : ""}`,
      );
    doc.text(
      r.traffic.impressions != null && r.traffic.period
        ? `Google: ${r.traffic.clicks ?? 0} clics · ${r.traffic.impressions} impresiones. Período ${r.traffic.period.label}.`
        : "Sin datos de Search Console. No se estima tráfico ni retorno económico.",
    );
    doc.moveDown();
    doc.fontSize(15).text("Próximas acciones");
    for (const [i, a] of r.actions.entries()) {
      doc.moveDown(0.5);
      doc
        .fontSize(12)
        .fillColor(color)
        .text(`${i + 1}. ${a.title}`);
      doc
        .fillColor("#222222")
        .fontSize(10)
        .text(
          `${a.kind ? `${a.kind} · ` : ""}${a.affected} ${a.affected === 1 ? "URL" : "URLs"} · ${({ detected: "detectado", pending: "pendiente", reappeared: "reapareció", resolved: "solucionado", ignored: "ignorado" } as Record<string, string>)[a.status] ?? a.status}`,
        )
        .text(technicalMarkdown ? a.reason : a.reason.split(" Prioridad:")[0].split(" Evidencia (")[0]);
      if (a.evidence?.length) doc.fillColor("#666666").fontSize(9).text(`Evidencia${r.crawledAt ? ` (crawl del ${r.crawledAt.slice(0, 10)})` : ""}:\n${a.evidence.join("\n")}`).fillColor("#222222");
    }
    if (!r.actions.length)
      doc
        .fontSize(11)
        .text(
          "No hay tareas pendientes registradas. Revisa la cobertura de la auditoría antes de concluir que el sitio no tiene problemas.",
        );
    const heading = (title: string) => {
      if (doc.y > 690) doc.addPage();
      doc
        .moveDown()
        .fillColor(color)
        .font("ReportBold")
        .fontSize(15)
        .text(title);
      doc.fillColor("#222222").font("ReportRegular").fontSize(10);
    };
    heading("Diagnóstico y plan de corrección");
    const findings = r.findings ?? [];
    doc.text(
      findings.length
        ? `${[[KIND_LABEL.confirmed, "error confirmado", "errores confirmados"], [KIND_LABEL.possible, "hipótesis por verificar", "hipótesis por verificar"], [KIND_LABEL.opportunity, "mejora opcional", "mejoras opcionales"]].map(([k, one, many]) => { const n = findings.filter((f) => f.kind === k).length; return n ? `${n} ${n === 1 ? one : many}` : ""; }).filter(Boolean).join(", ")}. Las mejoras opcionales no son errores: el sitio funciona sin ellas.`
        : "No hay incidencias registradas en la auditoría disponible.",
    );
    for (const [index, f] of findings.slice(0, 8).entries()) {
      if (doc.y > 640) doc.addPage();
      doc
        .moveDown()
        .font("ReportBold")
        .fontSize(12)
        .text(`${index + 1}. ${f.title} · ${f.count} ${f.count === 1 ? "URL" : "URLs"}`);
      doc
        .font("ReportRegular")
        .fontSize(10)
        .text(`Estado: ${f.kind ?? "por verificar"}`)
        .text(`Impacto: ${f.why}`)
        .text(`Corrección: ${f.fix}`);
      const ev = f.evidence?.length ? f.evidence : f.urls;
      if (ev.length)
        doc
          .fillColor("#666666")
          .fontSize(9)
          .text(`Evidencia${r.crawledAt ? ` (crawl del ${r.crawledAt.slice(0, 10)})` : ""}:\n${ev.slice(0, 3).join("\n")}`)
          .fillColor("#222222");
      doc
        .fontSize(10)
        .text(`Verificación: ${f.verify ?? "repetir la auditoría y revisar la URL."}`);
    }
    if (r.intentional?.length) {
      heading("Revisado: comportamiento intencional");
      doc.text("No son errores y no hay que corregirlos; confirmar solo si no corresponde a lo que el sitio quiere.");
      for (const x of r.intentional) doc.moveDown(0.3).text(`• ${x.text}.`).fillColor("#666666").fontSize(9).text(x.examples.slice(0, 2).join("\n")).fillColor("#222222").fontSize(10);
    }
    if (r.queries?.length) {
      heading("Visibilidad en Google");
      doc.text(
        `Consultas principales por impresiones. Período ${r.traffic.period?.start ?? ""} a ${r.traffic.period?.end ?? ""}, filas por consulta de Search Console. ${SOURCE_NOTE}`,
      );
      for (const q of r.queries)
        doc.text(
          `${q.query}: ${q.clicks} clics / ${q.impressions} impresiones · CTR ${q.impressions ? ((100 * q.clicks) / q.impressions).toFixed(1) : "0"}% · posición ${q.position?.toFixed(1) ?? "—"}`,
        );
    }
    if (r.speed?.length) {
      heading("Velocidad medida");
      for (const s of r.speed.slice(0, 6)) {
        const lab = s.lab as Record<string, any>;
        doc
          .text(`${s.url} (${s.strategy}, ${s.date.slice(0, 10)})`)
          .text(
            `PageSpeed ${s.score ?? "sin puntuación"}/100 · LCP ${lab.lcp != null ? (lab.lcp / 1000).toFixed(2) + " s" : "sin datos"} · CLS ${lab.cls ?? "sin datos"}. Medición de laboratorio (una carga simulada).`,
          );
        const fld = s.field as Record<string, any> | null;
        doc.text(
          fld?.source
            ? `Usuarios reales (CrUX, ${fld.source === "origin" ? "todo el origen" : "esta URL"}): LCP ${fld.lcp?.p75 ?? "–"} ms · INP ${fld.inp?.p75 ?? "–"} ms · CLS ${fld.cls?.p75 ?? "–"}.`
            : "Sin datos de usuarios reales (Core Web Vitals de campo) para esta URL.",
        );
      }
    }
    heading("Alcance y datos pendientes");
    for (const s of r.sources ?? [])
      doc.text(
        `${s.label}: ${s.state === "ok" ? "disponible" : "incompleto"}. ${s.state === "missing" ? "Pendiente de configuración." : s.detail}`,
      );
    doc.text(
      "Las fuentes pendientes limitan el diagnóstico. Completar esos datos permite evaluar tráfico, indexación, velocidad y oportunidades con mayor precisión.",
    );
    if (technicalMarkdown) {
      doc.addPage();
      heading("Evidencia técnica e instrucciones de implementación");
      for (const line of technicalMarkdown.split("\n")) {
        const clean = line
          .replace(/\*\*|`/g, "")
          .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
        if (/^#{1,6} /.test(line)) {
          if (doc.y > 670) doc.addPage();
          doc
            .moveDown(0.5)
            .font("ReportBold")
            .fontSize(/^# /.test(line) ? 15 : 12)
            .text(clean.replace(/^#+ /, ""));
        } else if (line.trim() && !/^```|^\|[ :|-]+\|$/.test(line))
          doc.font("ReportRegular").fontSize(9).text(clean);
      }
    }
    doc.moveDown();
    doc.moveDown();
    doc
      .fontSize(9)
      .fillColor("#666666")
      .text(
        "La salud es una métrica interna, no una puntuación de Google. El informe técnico Markdown conserva el detalle para implementación; las URLs afectadas están disponibles por separado en CSV.",
      );
    const pages = doc.bufferedPageRange();
    for (let i = pages.start; i < pages.start + pages.count; i++) {
      doc.switchToPage(i);
      doc
        .font("ReportRegular")
        .fontSize(8)
        .fillColor("#777777")
        .text(`${r.domain} · ${i + 1} / ${pages.count}`, 48, 800, {
          lineBreak: false,
        });
    }
    doc.end();
  });
}
export function csvCell(value: unknown) {
  // Spreadsheet formula injection also applies to filenames, URLs and page titles.
  let s = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
export async function issueCsv(projectId: string) {
  const c = await db.crawl.findFirst({
    where: { projectId, status: { in: ["completed", "partial"] } },
    orderBy: { startedAt: "desc" },
    include: { issues: true },
  });
  return (
    "\uFEFF" +
    [
      ["URL", "Código", "Severidad", "Detalle"],
      ...(c?.issues.map((i) => [i.url, i.code, i.severity, i.detail]) ?? []),
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n")
  );
}
export function nextReportAt(frequency: string, from = new Date()) {
  const next = new Date(from);
  if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  else if (frequency === "monthly") {
    const day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const last = new Date(
      Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
    ).getUTCDate();
    next.setUTCDate(Math.min(day, last));
  } else throw new Error("Frecuencia inválida");
  return next;
}
