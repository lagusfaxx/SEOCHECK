import { db } from "./db";

export const WORKER = "worker";
/** Un trabajo corriendo sin pulso por más de esto se considera colgado. */
export const STALE_MS = 5 * 60_000;
/** El worker late cada 30 s; sin pulso por más de esto, se considera caído. */
export const WORKER_DOWN_MS = 2 * 60_000;

export async function beat(name = WORKER) {
  await db.heartbeat.upsert({ where: { name }, create: { name, at: new Date() }, update: { at: new Date() } }).catch(() => {});
}

export async function workerAlive(now = Date.now()) {
  const hb = await db.heartbeat.findUnique({ where: { name: WORKER } });
  return Boolean(hb && now - hb.at.getTime() < WORKER_DOWN_MS);
}

/**
 * Al arrancar el worker: lo que quedó "corriendo" murió con el proceso anterior (redeploy/reinicio).
 * Se cancela en pg-boss (si no, lo reintenta horas después) y se marca en la UI.
 * Supone un solo worker, que es como corre el compose.
 */
export async function recoverInterrupted() {
  const msg = "Interrumpido: el worker se reinició (redeploy). Vuelve a lanzarlo.";
  await db.$executeRawUnsafe(`UPDATE pgboss.job SET state = 'cancelled', completed_on = now() WHERE state = 'active'`).catch(() => {});
  const runs = await db.jobRun.updateMany({ where: { status: "running" }, data: { status: "error", message: msg } });
  await db.crawl.updateMany({ where: { status: { in: ["running", "crawling"] } }, data: { status: "failed", reason: "Interrumpido: el worker se reinició antes de terminar.", finishedAt: new Date() } });
  await db.contentAnalysis.updateMany({ where: { status: { in: ["running", "brief"] } }, data: { status: "error" } });
  await db.keywordRun.updateMany({ where: { status: { notIn: ["queued", "done", "error"] } }, data: { status: "error" } });
  return runs.count;
}

/** Trabajos "corriendo" sin pulso hace más de STALE_MS: se marcan como interrumpidos. */
export async function sweepStale(projectId?: string, now = Date.now()) {
  const r = await db.jobRun.updateMany({
    where: { ...(projectId ? { projectId } : {}), status: "running", updatedAt: { lt: new Date(now - STALE_MS) } },
    data: { status: "error", message: "Sin respuesta del worker hace más de 5 minutos (¿se reinició o se cayó?). Vuelve a lanzarlo." },
  });
  return r.count;
}

/** Mantiene vivo el JobRun mientras el handler trabaja (pasos largos sin progreso). */
export function keepAlive(jobRunId: string | undefined, everyMs = 60_000) {
  if (!jobRunId) return () => {};
  const t = setInterval(() => {
    db.jobRun.updateMany({ where: { id: jobRunId, status: { in: ["queued", "running"] } }, data: { updatedAt: new Date() } }).catch(() => {});
  }, everyMs);
  return () => clearInterval(t);
}
