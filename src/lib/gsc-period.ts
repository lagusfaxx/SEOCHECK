import { db } from "./db";

/**
 * Período único de Search Console para todo lo que muestra una cifra (informe, PDF, tareas).
 * Antes cada vista cortaba distinto (hoy − 28 días, último dato − 27, hoy − 30) y el mismo informe
 * mostraba 32/96 y 48/132 clics/impresiones. Ahora el corte es siempre el último día con datos
 * (GSC llega con 2–3 días de atraso) y los 28 días que terminan ahí.
 */
export type GscPeriod = {
  /** primer día incluido (UTC, fecha GSC) */
  start: Date;
  /** último día incluido */
  end: Date;
  /** día siguiente al último: para filtros `lt` */
  endExclusive: Date;
  /** período anterior de igual largo */
  prevStart: Date;
  days: number;
};

export const GSC_DAYS = 28;
const DAY = 864e5;
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function periodEndingAt(end: Date, days = GSC_DAYS): GscPeriod {
  const start = new Date(end.getTime() - (days - 1) * DAY);
  return { start, end, endExclusive: new Date(end.getTime() + DAY), prevStart: new Date(start.getTime() - days * DAY), days };
}

/** Período de los últimos 28 días con datos del proyecto, o null si no hay Search Console. */
export async function gscPeriod(projectId: string, days = GSC_DAYS): Promise<GscPeriod | null> {
  const [row, day] = await Promise.all([
    db.gscRow.findFirst({ where: { projectId }, orderBy: { date: "desc" }, select: { date: true } }),
    db.gscDay.findFirst({ where: { projectId }, orderBy: { date: "desc" }, select: { date: true } }),
  ]);
  const ends = [row?.date, day?.date].filter((d): d is Date => Boolean(d));
  if (!ends.length) return null;
  // el último día presente en las dos tablas: así totales y filas por consulta cubren los mismos días
  const end = ends.length === 2 ? new Date(Math.min(ends[0].getTime(), ends[1].getTime())) : ends[0];
  return periodEndingAt(end, days);
}

/** Etiqueta para poner junto a cada cifra: período y origen. */
export function periodLabel(p: GscPeriod, source: "totals" | "rows") {
  return `${isoDay(p.start)} a ${isoDay(p.end)} (${p.days} días) · ${source === "totals" ? "Search Console, totales del sitio" : "Search Console, filas por consulta y página (excluye consultas anonimizadas)"}`;
}

export const SOURCE_NOTE =
  "Los totales del sitio incluyen las consultas que Google anonimiza; las tablas por consulta o página no las incluyen, por eso suman menos. No son cifras contradictorias: son cortes distintos de la misma fuente y período.";
