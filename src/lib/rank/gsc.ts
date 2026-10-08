import { db } from "../db";
import { gscQuery, resolveGscProperty } from "../providers/google";
import { jobLog } from "../jobctx";

/**
 * Propiedad GSC del proyecto, corregida al formato real que ve la cuenta de servicio
 * (p. ej. guardada como sc-domain:dominio.cl pero en Search Console es https://dominio.cl/). Se guarda la corrección.
 */
export async function projectGscProperty(p: { id: string; gscProperty: string | null }): Promise<string | null> {
  if (!p.gscProperty) return null;
  const real = await resolveGscProperty(p.gscProperty);
  if (real !== p.gscProperty) {
    await db.project.update({ where: { id: p.id }, data: { gscProperty: real } });
    await jobLog("info", `Propiedad GSC corregida: ${p.gscProperty} → ${real}`);
  }
  return real;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Sync diario date × query × page. Primer sync hace backfill de `backfillDays`. */
export async function syncGsc(projectId: string, backfillDays = 90, onProgress?: (pct: number) => Promise<void>) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const prop = await projectGscProperty(p);
  if (!prop) throw new Error("El proyecto no tiene propiedad de GSC");
  const last = await db.gscRow.findFirst({ where: { projectId }, orderBy: { date: "desc" } });
  // proyectos sincronizados antes de existir GscDay: rellenar los totales del período completo una vez
  const needDays = last && !(await db.gscDay.findFirst({ where: { projectId } }));
  const end = new Date(Date.now() - 2 * 864e5);
  const start = last ? new Date(last.date.getTime() - 3 * 864e5) : new Date(end.getTime() - backfillDays * 864e5);
  const totalsStart = needDays ? new Date(end.getTime() - backfillDays * 864e5) : start;
  const days: string[] = [];
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 864e5)) days.push(day(d));
  let total = 0;
  for (let i = 0; i < days.length; i++) {
    const date = days[i];
    let startRow = 0;
    for (;;) {
      const rows = await gscQuery(prop, { startDate: date, endDate: date, dimensions: ["date", "query", "page"], rowLimit: 25000, startRow, dataState: "all" });
      if (!rows.length) break;
      const data = rows.map((r) => ({
        projectId, date: new Date(r.keys[0]), query: r.keys[1], page: r.keys[2],
        clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
      }));
      await db.$transaction([
        ...(startRow === 0 ? [db.gscRow.deleteMany({ where: { projectId, date: new Date(date) } })] : []),
        db.gscRow.createMany({ data, skipDuplicates: true }),
      ]);
      total += rows.length;
      if (rows.length < 25000) break;
      startRow += 25000;
    }
    await onProgress?.(((i + 1) / days.length) * 100);
  }
  // totales del sitio por día: sin dimensión de consulta/página Google sí incluye las consultas anonimizadas,
  // así que estos son los números que coinciden con el gráfico de Search Console
  const t0 = day(totalsStart), t1 = day(end);
  const totals = await gscQuery(prop, { startDate: t0, endDate: t1, dimensions: ["date"], rowLimit: 25000, dataState: "all" });
  if (totals.length)
    await db.$transaction([
      db.gscDay.deleteMany({ where: { projectId, date: { gte: new Date(t0), lte: new Date(t1) } } }),
      db.gscDay.createMany({
        data: totals.map((r) => ({ projectId, date: new Date(r.keys[0]), clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
        skipDuplicates: true,
      }),
    ]);
  return { days: days.length, rows: total };
}
