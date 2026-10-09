import path from "node:path";
import PDFDocument from "pdfkit";
import { db } from "./db";
import { buildReport } from "./report";
import { projectActions } from "./tasks";
import { withProjectQuota, projectPlan } from "./plans";
import { issueIdentity } from "./task-rules";
import { ISSUE_LABELS } from "./audit/issues";
import { ISSUE_FIX, ISSUE_WHY } from "./audit/fixes";
import { coverage } from "./coverage";

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
  const [p, comparison, actions, plan, gsc] = await Promise.all([
    db.project.findUniqueOrThrow({ where: { id: projectId } }),
    auditComparison(projectId),
    projectActions(projectId),
    projectPlan(projectId),
    db.gscDay.aggregate({
      where: { projectId, date: { gte: new Date(Date.now() - 28 * 864e5) } },
      _sum: { clicks: true, impressions: true },
    }),
  ]);
  const branding = plan.limits.whiteLabel
    ? (plan.workspace.branding as Record<string, any>)
    : {};
  const [issues, sources, queries, speed] = await Promise.all([
    comparison
      ? db.issue.findMany({ where: { crawlId: comparison.currentId } })
      : [],
    coverage(projectId),
    db.gscRow.groupBy({
      by: ["query"],
      where: { projectId, date: { gte: new Date(Date.now() - 28 * 864e5) } },
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
  const grouped = new Map<
    string,
    {
      code: string;
      title: string;
      severity: string;
      count: number;
      why: string;
      fix: string;
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
    if (g.urls.length < 5 && !g.urls.includes(i.url)) g.urls.push(i.url);
    if (g.evidence.length < 2 && i.detail && !g.evidence.includes(i.detail))
      g.evidence.push(i.detail);
    grouped.set(i.code, g);
  }
  const weight: Record<string, number> = { critical: 3, warning: 2, info: 1 };
  return {
    project: p.name,
    domain: p.domain,
    generatedAt: new Date().toISOString(),
    comparison,
    actions: actions.actions.map((t) => ({
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
    traffic: { clicks: gsc._sum.clicks, impressions: gsc._sum.impressions },
    branding,
    findings: [...grouped.values()].sort(
      (a, b) =>
        (weight[b.severity] ?? 0) - (weight[a.severity] ?? 0) ||
        b.count - a.count,
    ),
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
  return withProjectQuota(projectId, "reports", 1, (tx) =>
    tx.reportSnapshot.create({
      data: { projectId, executive: executive as any, markdown },
    }),
  );
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
        Author: r.branding.name || "SEOCHECK",
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
      .text(r.branding.name || "SEOCHECK");
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
        ? `Salud técnica: ${c.health ?? "sin datos"}/100${c.previousId ? ` (anterior: ${c.previousHealth ?? "sin datos"})` : " (primera auditoría)"}. ${c.pages} URLs auditadas.`
        : "Todavía no hay una auditoría terminada.",
    );
    if (c?.previousId)
      doc.text(
        `${c.new ?? "—"} incidencias nuevas. ${c.resolved ?? "No confirmado"} solucionadas.${c.partial ? " Auditoría parcial: no se confirma la desaparición de problemas." : ""}`,
      );
    doc.text(
      r.traffic.impressions != null
        ? `Google (últimos 28 días): ${r.traffic.clicks ?? 0} clics · ${r.traffic.impressions} impresiones.`
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
          `${a.affected} incidencias agrupadas · ${({ detected: "detectado", pending: "pendiente", reappeared: "reapareció", resolved: "solucionado", ignored: "ignorado" } as Record<string, string>)[a.status] ?? a.status}`,
        )
        .text(technicalMarkdown ? a.reason : a.reason.split(" Prioridad:")[0]);
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
        ? `${findings.length} tipos de problema detectados. Se agrupan las incidencias para corregir su causa, en lugar de tratar cada URL como un trabajo independiente.`
        : "No hay incidencias registradas en la auditoría disponible.",
    );
    for (const [index, f] of findings.slice(0, 8).entries()) {
      if (doc.y > 640) doc.addPage();
      doc
        .moveDown()
        .font("ReportBold")
        .fontSize(12)
        .text(`${index + 1}. ${f.title} · ${f.count} incidencias`);
      doc
        .font("ReportRegular")
        .fontSize(10)
        .text(`Impacto: ${f.why}`)
        .text(`Corrección: ${f.fix}`);
      if (f.urls.length)
        doc
          .fillColor("#666666")
          .fontSize(9)
          .text(`Ejemplos: ${f.urls.slice(0, 3).join("\n")}`)
          .fillColor("#222222");
      doc
        .fontSize(10)
        .text(
          "Verificación: repetir la auditoría; la incidencia debe desaparecer en las URLs revisadas correctamente.",
        );
    }
    if (r.queries?.length) {
      heading("Visibilidad en Google · últimos 28 días");
      doc.text(
        "Consultas principales por impresiones (posición media de las filas disponibles):",
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
            `PageSpeed ${s.score ?? "sin puntuación"}/100 · LCP ${lab.lcp != null ? (lab.lcp / 1000).toFixed(2) + " s" : "sin datos"} · CLS ${lab.cls ?? "sin datos"}. Medición de laboratorio.`,
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
