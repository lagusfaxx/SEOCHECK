/**
 * Exportación para Google Sheets (IMPORTDATA) y Looker Studio: CSV de solo lectura por proyecto con un token
 * secreto en la URL (esas herramientas no pueden iniciar sesión). Se guarda solo el hash del token; regenerarlo
 * revoca el enlace anterior.
 */
import { db } from "./db";
import { newToken, tokenHash } from "./auth";
import { csvCell } from "./reporting";
import { gscPeriod } from "./gsc-period";

export const FEEDS = ["diario", "paginas", "consultas", "tareas", "rankings"] as const;
export type Feed = (typeof FEEDS)[number];
const DAY = 864e5;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const csv = (rows: unknown[][]) => "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");

/** Crea (o reemplaza) el token del proyecto y devuelve el token en claro una sola vez. */
export async function rotateFeedToken(projectId: string) {
  const token = newToken();
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { settings: true } });
  const settings = (p.settings ?? {}) as Record<string, any>;
  await db.project.update({ where: { id: projectId }, data: { settings: { ...settings, feed: { hash: tokenHash(token), createdAt: new Date().toISOString() } } } });
  return token;
}
export async function revokeFeedToken(projectId: string) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { settings: true } });
  const { feed: _, ...rest } = (p.settings ?? {}) as Record<string, any>;
  await db.project.update({ where: { id: projectId }, data: { settings: rest } });
}

export async function projectByFeedToken(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) return null;
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM "Project" WHERE settings->'feed'->>'hash' = ${tokenHash(token)} LIMIT 1`;
  return rows[0]?.id ?? null;
}

/** CSV del conjunto pedido. Fechas en YYYY-MM-DD; números sin formato para que Sheets/Looker los lean bien. */
export async function feedCsv(projectId: string, feed: Feed): Promise<string> {
  if (feed === "diario") {
    const from = new Date(Date.now() - 400 * DAY);
    const [days, ga] = await Promise.all([
      db.gscDay.findMany({ where: { projectId, date: { gte: from } }, orderBy: { date: "asc" } }),
      db.ga4Row.groupBy({ by: ["date"], where: { projectId, date: { gte: from } }, _sum: { sessions: true, keyEvents: true, revenue: true } }),
    ]);
    const g = new Map(ga.map((r) => [iso(r.date), r._sum]));
    const dates = [...new Set([...days.map((d) => iso(d.date)), ...g.keys()])].sort();
    const d = new Map(days.map((x) => [iso(x.date), x]));
    return csv([["fecha", "clics", "impresiones", "ctr", "posicion", "sesiones_organicas", "conversiones", "ingresos"], ...dates.map((k) => [k, d.get(k)?.clicks ?? "", d.get(k)?.impressions ?? "", d.get(k)?.ctr ?? "", d.get(k)?.position ?? "", g.get(k)?.sessions ?? "", g.get(k)?.keyEvents ?? "", g.get(k)?.revenue ?? ""])]);
  }
  const period = await gscPeriod(projectId);
  if (feed === "paginas" || feed === "consultas") {
    if (!period) return csv([[feed === "paginas" ? "pagina" : "consulta", "clics", "impresiones", "posicion"]]);
    const by = feed === "paginas" ? "page" : "query";
    const rows = await db.gscRow.groupBy({ by: [by], where: { projectId, date: { gte: period.start, lt: period.endExclusive } }, _sum: { clicks: true, impressions: true }, _avg: { position: true } });
    const top = rows.sort((a, b) => (b._sum.impressions ?? 0) - (a._sum.impressions ?? 0)).slice(0, 5000);
    return csv([[feed === "paginas" ? "pagina" : "consulta", "clics", "impresiones", "posicion", "desde", "hasta"], ...top.map((r) => [(r as any)[by], r._sum.clicks ?? 0, r._sum.impressions ?? 0, Math.round((r._avg.position ?? 0) * 10) / 10, iso(period.start), iso(period.end)])]);
  }
  if (feed === "tareas") {
    const t = await db.projectTask.findMany({ where: { projectId }, orderBy: [{ priority: "desc" }] , take: 5000 });
    return csv([["tarea", "url", "estado", "severidad", "responsable", "fecha_limite", "detectada", "resuelta"], ...t.map((x) => [x.title, x.url ?? "", x.status, x.severity, x.assignee ?? "", x.dueAt ? iso(x.dueAt) : "", iso(x.firstSeenAt), x.resolvedAt ? iso(x.resolvedAt) : ""])]);
  }
  const tracked = await db.trackedKeyword.findMany({ where: { projectId, active: true }, include: { checks: { orderBy: { date: "desc" }, take: 60 } } });
  return csv([["fecha", "keyword", "posicion", "url"], ...tracked.flatMap((k) => k.checks.map((c) => [iso(c.date), k.keyword, c.position ?? "", c.url ?? ""]))]);
}
