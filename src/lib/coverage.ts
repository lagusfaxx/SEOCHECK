/**
 * Cobertura de datos del proyecto: para cada módulo, si hay datos, si el último intento FALLÓ (y por qué),
 * si falta configurarlo o si nunca se corrió. Así el informe y el resumen no confunden "sin datos" con "falló".
 */
import { db } from "./db";
import { env } from "./env";
import { QUEUES } from "./queue";
import { gscAvailable } from "./providers/google";

export type ModState = "ok" | "partial" | "failed" | "missing" | "never";
export type Module = { key: string; label: string; state: ModState; detail: string; /** % del sitio leído (solo crawl) */ percent?: number };

export const STATE_LABEL: Record<ModState, string> = { ok: "con datos", partial: "parcial", failed: "falló", missing: "no configurado", never: "sin correr" };

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

/** Último trabajo terminado de un tipo (para saber si el último intento falló). */
async function lastJob(projectId: string, kind: string) {
  return db.jobRun.findFirst({ where: { projectId, kind, status: { in: ["done", "error"] } }, orderBy: { createdAt: "desc" }, select: { status: true, message: true, updatedAt: true } });
}

export async function coverage(projectId: string): Promise<Module[]> {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { gscProperty: true } });
  const out: Module[] = [];

  // Auditoría
  const crawl = await db.crawl.findFirst({ where: { projectId, status: { notIn: ["queued", "running"] } }, orderBy: { startedAt: "desc" } });
  if (!crawl) out.push({ key: "crawl", label: "Auditoría (crawl)", state: "never", detail: "Todavía no se crawleó el sitio" });
  else {
    const st = crawl.stats as Record<string, any>;
    const opts = crawl.options as Record<string, any>;
    const pages = st.pages ?? 0;
    if (crawl.status === "failed") out.push({ key: "crawl", label: "Auditoría (crawl)", state: "failed", detail: crawl.reason ?? "El crawl falló", percent: 0 });
    else if (crawl.status === "cancelled") out.push({ key: "crawl", label: "Auditoría (crawl)", state: "failed", detail: "El último crawl se canceló" });
    else if (crawl.status === "partial") out.push({ key: "crawl", label: "Auditoría (crawl)", state: "partial", detail: `${crawl.reason ?? "Parcial"} (${pages} URL${pages === 1 ? "" : "s"}, ${day(crawl.startedAt)})`, percent: pages ? Math.round(((st.ok ?? pages) / pages) * 100) : 0 });
    else if (st.limitReached ?? (opts.maxPages && pages - Math.min(st.orphans ?? 0, 300) >= opts.maxPages))
      out.push({ key: "crawl", label: "Auditoría (crawl)", state: "partial", detail: `Llegó al máximo de ${opts.maxPages} páginas: puede faltar parte del sitio (${day(crawl.startedAt)})`, percent: st.sitemapNotReached ? Math.min(99, Math.round((pages / (pages + st.sitemapNotReached)) * 100)) : undefined });
    else out.push({ key: "crawl", label: "Auditoría (crawl)", state: "ok", detail: `Sitio completo: ${pages} URL${pages === 1 ? "" : "s"} (${day(crawl.startedAt)})`, percent: 100 });
  }

  // Search Console
  const gscMode = await gscAvailable(projectId);
  const lastGsc = await db.gscDay.findFirst({ where: { projectId }, orderBy: { date: "desc" }, select: { date: true } }) ?? (await db.gscRow.findFirst({ where: { projectId }, orderBy: { date: "desc" }, select: { date: true } }));
  const gscJob = await lastJob(projectId, QUEUES.gscSync);
  if (!gscMode || !p.gscProperty) out.push({ key: "gsc", label: "Search Console", state: "missing", detail: !gscMode ? "No conectado" : "Falta elegir la propiedad" });
  else if (gscJob?.status === "error") out.push({ key: "gsc", label: "Search Console", state: "failed", detail: `La última sincronización falló: ${gscJob.message ?? "sin detalle"}${lastGsc ? ` (hay datos hasta ${day(lastGsc.date)})` : ""}` });
  else if (lastGsc) out.push({ key: "gsc", label: "Search Console", state: "ok", detail: `Datos hasta ${day(lastGsc.date)}` });
  else out.push({ key: "gsc", label: "Search Console", state: "never", detail: "Conectado, falta sincronizar" });

  // PageSpeed
  const psiCount = await db.psiResult.count({ where: { projectId } });
  const psiJob = await lastJob(projectId, QUEUES.psi);
  if (!env.psiKey && !psiCount) out.push({ key: "psi", label: "PageSpeed", state: "missing", detail: "Falta PAGESPEED_API_KEY" });
  else if (psiJob?.status === "error") out.push({ key: "psi", label: "PageSpeed", state: "failed", detail: `La última medición falló: ${psiJob.message ?? "sin detalle"}` });
  else if (psiCount) out.push({ key: "psi", label: "PageSpeed", state: "ok", detail: `${psiCount} mediciones` });
  else out.push({ key: "psi", label: "PageSpeed", state: "never", detail: "Disponible, sin medir aún" });

  // Indexación
  const inspCount = await db.urlInspection.count({ where: { projectId } });
  const inspJob = await lastJob(projectId, QUEUES.inspect);
  if (!gscMode) out.push({ key: "inspect", label: "Indexación", state: "missing", detail: "Requiere Search Console" });
  else if (inspJob?.status === "error") out.push({ key: "inspect", label: "Indexación", state: "failed", detail: `La última inspección falló: ${inspJob.message ?? "sin detalle"}` });
  else if (inspCount) out.push({ key: "inspect", label: "Indexación", state: "ok", detail: `${inspCount} ${inspCount === 1 ? "URL inspeccionada" : "URLs inspeccionadas"}` });
  else out.push({ key: "inspect", label: "Indexación", state: "never", detail: "Sin inspecciones" });

  // Keywords
  const run = await db.keywordRun.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" }, select: { status: true, createdAt: true } });
  const runDone = await db.keywordRun.findFirst({ where: { projectId, status: "done" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (!run) out.push({ key: "keywords", label: "Keywords", state: "never", detail: "Sin investigación de keywords" });
  else if (run.status === "error") out.push({ key: "keywords", label: "Keywords", state: "failed", detail: `La última investigación falló${runDone ? ` (hay uno anterior del ${day(runDone.createdAt)})` : ""}` });
  else if (runDone) out.push({ key: "keywords", label: "Keywords", state: "ok", detail: `Investigación del ${day(runDone.createdAt)}` });
  else out.push({ key: "keywords", label: "Keywords", state: "never", detail: "Investigación en curso" });

  // Rankings
  const tracked = await db.trackedKeyword.count({ where: { projectId, active: true } });
  const rankJob = await lastJob(projectId, QUEUES.rankOne);
  const lastCheck = await db.rankCheck.findFirst({ where: { tracked: { projectId } }, orderBy: { date: "desc" }, select: { date: true } });
  if (!env.serpentKey) out.push({ key: "rank", label: "Rankings", state: "missing", detail: "Falta SERPENT_API_KEY" });
  else if (!tracked) out.push({ key: "rank", label: "Rankings", state: "never", detail: "Sin keywords trackeadas" });
  else if (rankJob?.status === "error") out.push({ key: "rank", label: "Rankings", state: "failed", detail: `La última revisión falló: ${rankJob.message ?? "sin detalle"}` });
  else if (lastCheck) out.push({ key: "rank", label: "Rankings", state: "ok", detail: `${tracked} keywords, revisadas el ${day(lastCheck.date)}` });
  else out.push({ key: "rank", label: "Rankings", state: "never", detail: `${tracked} keywords sin revisar aún` });

  return out;
}

/** Texto para una sección sin datos: dice si falló, si falta configurar o si nunca se corrió. */
export const emptyText = (m: Module | undefined) => (m ? `_${m.state === "failed" ? "⚠ Falló" : STATE_LABEL[m.state].charAt(0).toUpperCase() + STATE_LABEL[m.state].slice(1)}: ${m.detail}._` : "_Sin datos._");

/** Texto corto para la barra de cobertura: "Crawl 100%", "GSC conectado", "Indexación no configurada". */
export function shortLabel(m: Module): string {
  const S: Record<string, Partial<Record<ModState, string>>> = {
    crawl: { ok: "Crawl 100%", partial: m.percent != null ? `Crawl ${m.percent}%` : "Crawl parcial", failed: "Crawl falló", never: "Crawl pendiente" },
    gsc: { ok: "GSC conectado", failed: "GSC con error", missing: "GSC no conectado", never: "GSC sin sincronizar" },
    psi: { ok: "PageSpeed con datos", failed: "PageSpeed falló", missing: "PageSpeed no configurado", never: "PageSpeed disponible" },
    inspect: { ok: "Indexación revisada", failed: "Indexación falló", missing: "Indexación no configurada", never: "Indexación sin revisar" },
    keywords: { ok: "Keywords al día", failed: "Keywords falló", never: "Keywords sin investigar" },
    rank: { ok: "Rankings activos", failed: "Rankings falló", missing: "Rankings no configurado", never: "Rankings sin keywords" },
  };
  return S[m.key]?.[m.state] ?? `${m.label}: ${STATE_LABEL[m.state]}`;
}
