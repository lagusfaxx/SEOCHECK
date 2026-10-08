import PDFDocument from "pdfkit";
import { db } from "./db";
import { buildReport } from "./report";
import { projectActions } from "./tasks";
import { withProjectQuota, projectPlan } from "./plans";
import { issueIdentity } from "./task-rules";

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
      url: t.url,
      status: t.status,
    })),
    improved: actions.improved.length,
    traffic: { clicks: gsc._sum.clicks, impressions: gsc._sum.impressions },
    branding,
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
export function executivePdf(r: ExecutiveReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: {
        Title: `Informe SEO · ${r.project}`,
        Author: r.branding.name || "SEOCHECK",
      },
    });
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
    doc.fillColor("#222222").fontSize(18).text("Informe ejecutivo SEO");
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
        ? `Salud: ${c.previousHealth ?? "sin comparación"} → ${c.health ?? "sin datos"}. ${c.pages} URLs auditadas.`
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
        .text(`${a.affected} incidencias agrupadas · ${a.status}`)
        .text(a.reason);
    }
    if (!r.actions.length)
      doc
        .fontSize(11)
        .text(
          "No hay tareas pendientes registradas. Revisa la cobertura de la auditoría antes de concluir que el sitio no tiene problemas.",
        );
    doc.moveDown();
    doc
      .fontSize(9)
      .fillColor("#666666")
      .text(
        "La salud es una métrica interna, no una puntuación de Google. El informe técnico Markdown conserva el detalle para implementación; las URLs afectadas están disponibles por separado en CSV.",
      );
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
