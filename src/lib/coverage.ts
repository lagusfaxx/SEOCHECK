/**
 * Cobertura de datos del proyecto: para cada módulo, si hay datos, si el último intento FALLÓ (y por qué),
 * si falta configurarlo o si nunca se corrió. Así el informe y el resumen no confunden "sin datos" con "falló".
 */
import { db } from "./db";
import { UNAVAILABLE } from "./presentation";
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
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { gscProperty: true, settings: true } });
  const out: Module[] = [];

  // Auditoría
  const crawl = await db.crawl.findFirst({ where: { projectId, private: false, status: { notIn: ["queued", "running"] } }, orderBy: { startedAt: "desc" } });
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
  if (!env.psiKey && !psiCount) out.push({ key: "psi", label: "PageSpeed", state: "missing", detail: UNAVAILABLE });
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
  if (!env.serpentKey) out.push({ key: "rank", label: "Rankings", state: "missing", detail: UNAVAILABLE });
  else if (!tracked) out.push({ key: "rank", label: "Rankings", state: "never", detail: "Sin keywords trackeadas" });
  else if (rankJob?.status === "error") out.push({ key: "rank", label: "Rankings", state: "failed", detail: `La última revisión falló: ${rankJob.message ?? "sin detalle"}` });
  else if (lastCheck) out.push({ key: "rank", label: "Rankings", state: "ok", detail: `${tracked} keywords, revisadas el ${day(lastCheck.date)}` });
  else out.push({ key: "rank", label: "Rankings", state: "never", detail: `${tracked} keywords sin revisar aún` });

  // Google Analytics (misma conexión de Google)
  const ga4 = ((p.settings ?? {}) as any).ga4?.property as string | undefined;
  const ga4Last = await db.ga4Row.findFirst({ where: { projectId }, orderBy: { date: "desc" }, select: { date: true } });
  const ga4Job = await db.jobRun.findFirst({ where: { projectId, kind: "ga4.sync" }, orderBy: { createdAt: "desc" }, select: { status: true, message: true } });
  if (!ga4) out.push({ key: "ga4", label: "Google Analytics", state: "missing", detail: "Falta conectar y elegir la propiedad (Resultados)" });
  else if (ga4Job?.status === "error") out.push({ key: "ga4", label: "Google Analytics", state: "failed", detail: `La última sincronización falló: ${ga4Job.message ?? "sin detalle"}` });
  else if (ga4Last) out.push({ key: "ga4", label: "Google Analytics", state: "ok", detail: `Datos hasta ${day(ga4Last.date)}` });
  else out.push({ key: "ga4", label: "Google Analytics", state: "never", detail: "Propiedad elegida, falta sincronizar" });

  // Visibilidad en IA y SEO local (Serpent del servidor)
  const aiLast = await db.aiCheck.findFirst({ where: { projectId }, orderBy: { checkedAt: "desc" }, select: { checkedAt: true } });
  const localLast = await db.localRank.findFirst({ where: { projectId }, orderBy: { checkedAt: "desc" }, select: { checkedAt: true } });
  const localCfg = ((p.settings ?? {}) as any).local ?? {};
  if (!env.serpentKey) out.push({ key: "ai", label: "Visibilidad en IA", state: "missing", detail: UNAVAILABLE });
  else if (aiLast) out.push({ key: "ai", label: "Visibilidad en IA", state: "ok", detail: `Revisada el ${day(aiLast.checkedAt)}` });
  else out.push({ key: "ai", label: "Visibilidad en IA", state: "never", detail: tracked ? "Se revisa al ejecutar el análisis completo" : "Requiere keywords en Rankings" });
  if (!env.serpentKey) out.push({ key: "local", label: "SEO local", state: "missing", detail: UNAVAILABLE });
  else if (localLast) out.push({ key: "local", label: "SEO local", state: "ok", detail: `Revisado el ${day(localLast.checkedAt)}` });
  else out.push({ key: "local", label: "SEO local", state: "never", detail: localCfg.location && localCfg.keywords?.length ? "Se revisa al ejecutar el análisis completo" : "Falta configurar ciudad y keywords (Resultados)" });

  // Keyword gap (DataForSEO Labs, mensual)
  const gapLast = await db.keywordGap.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" }, select: { createdAt: true, errors: true } });
  if (!env.dfsLogin || !env.dfsPassword) out.push({ key: "gap", label: "Keyword gap", state: "missing", detail: UNAVAILABLE });
  else if (gapLast) out.push({ key: "gap", label: "Keyword gap", state: gapLast.errors.length ? "partial" : "ok", detail: `Calculado el ${day(gapLast.createdAt)}` });
  else out.push({ key: "gap", label: "Keyword gap", state: "never", detail: "Se calcula al ejecutar el análisis completo" });

  // Backlinks (cuenta DataForSEO del servidor: el cliente no configura nada)
  const bl = await db.backlinkSnapshot.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" }, select: { createdAt: true, errors: true } });
  if (!env.dfsLogin || !env.dfsPassword) out.push({ key: "backlinks", label: "Backlinks", state: "missing", detail: UNAVAILABLE });
  else if (!bl) out.push({ key: "backlinks", label: "Backlinks", state: "never", detail: "Se obtienen al ejecutar el análisis completo" });
  else out.push({ key: "backlinks", label: "Backlinks", state: bl.errors.length ? "partial" : "ok", detail: `Foto del ${day(bl.createdAt)}${bl.errors.length ? ` (${bl.errors.length} parte(s) sin datos)` : ""}` });

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
    ai: { ok: "IA revisada", missing: "IA no disponible", never: "IA pendiente" },
    local: { ok: "Local revisado", missing: "Local no disponible", never: "Local pendiente" },
    ga4: { ok: "Analytics conectado", failed: "Analytics con error", missing: "Analytics no conectado", never: "Analytics sin sincronizar" },
    gap: { ok: "Gap calculado", partial: "Gap parcial", missing: "Gap no disponible", never: "Gap pendiente" },
    backlinks: { ok: "Backlinks con datos", partial: "Backlinks parcial", missing: "Backlinks no disponible", never: "Backlinks pendiente" },
  };
  return S[m.key]?.[m.state] ?? `${m.label}: ${STATE_LABEL[m.state]}`;
}
