import { db } from "../db";
import { env } from "../env";
import { logCost } from "../costs";
import { jobLog } from "../jobctx";
import { chunk, fetchT, sleep } from "../util";
import { cleanKeyword, sanitizeKeywords } from "../providers/sanitize";
import type { VolumeCtx, VolumeData, VolumeProvider } from "./types";

/**
 * DataForSEO Google Ads search_volume.
 * - DATAFORSEO_ENV=sandbox (default): sandbox.dataforseo.com, gratis, datos ficticios.
 * - live: api.dataforseo.com.
 * Modo por defecto: standard queue (task_post → task_get), tasks de hasta 1.000 keywords que
 * juntan pedidos de varios proyectos (tabla VolumeRequest). Endpoint Live solo si el run lo pide.
 */
const PATH = "/v3/keywords_data/google_ads/search_volume";
export const dfsBase = () => env.dfsBaseOverride || (env.dfsEnv === "live" ? "https://api.dataforseo.com" : "https://sandbox.dataforseo.com");
const auth = () => `Basic ${Buffer.from(`${env.dfsLogin}:${env.dfsPassword}`).toString("base64")}`;

type Row = { keyword: string; search_volume: number | null; cpc: number | null; competition_index: number | null };

function toData(r: Row, originals: string[]): VolumeData[] {
  return originals.map((k) => ({
    keyword: k,
    volume: r.search_volume ?? null,
    cpc: r.cpc ?? null,
    competition: r.competition_index != null ? r.competition_index / 100 : null,
  }));
}

async function post(path: string, body: unknown) {
  const res = await fetchT(`${dfsBase()}${PATH}${path}`, { method: "POST", headers: { Authorization: auth(), "Content-Type": "application/json" }, body: JSON.stringify(body), timeoutMs: 120000 });
  if (!res.ok) throw new Error(`DataForSEO ${res.status}`);
  return (await res.json()) as any;
}

/** Live: un task; si DataForSEO rechaza el task completo, se parte en mitades para aislar keywords inválidas. */
async function liveTask(batch: string[], ctx: VolumeCtx, depth = 0): Promise<Row[]> {
  const json = await post("/live", [{ keywords: batch, location_code: ctx.locationCode, language_code: ctx.language }]);
  await logCost("dataforseo", `search_volume/live (${env.dfsEnv})`, 1, { projectId: ctx.projectId, ref: `${batch.length} keywords` });
  const task = json.tasks?.[0];
  if (task?.status_code && task.status_code >= 40000) {
    if (batch.length === 1 || depth >= 6) {
      await jobLog("warn", `DataForSEO rechazó ${batch.length} keyword(s): ${task.status_message}`, { keywords: batch.slice(0, 20) });
      return [];
    }
    const mid = Math.ceil(batch.length / 2);
    await jobLog("warn", `DataForSEO rechazó un task de ${batch.length} (${task.status_message}); se divide para aislar la keyword inválida`);
    return [...(await liveTask(batch.slice(0, mid), ctx, depth + 1)), ...(await liveTask(batch.slice(mid), ctx, depth + 1))];
  }
  return task?.result ?? [];
}

export async function dfsLive(keywords: string[], ctx: VolumeCtx): Promise<VolumeData[]> {
  const { valid, rejected } = sanitizeKeywords(keywords);
  if (rejected.length) await jobLog("info", `DataForSEO: ${rejected.length} keywords no válidas para Google Ads, no se envían`, { rejected: rejected.slice(0, 50) });
  const out: VolumeData[] = [];
  for (const batch of chunk([...valid.keys()], 1000)) for (const r of await liveTask(batch, ctx)) out.push(...toData(r, valid.get(String(r.keyword).toLowerCase()) ?? []));
  return out;
}

// ---------- Standard queue ----------

/** Encola keywords (de cualquier proyecto). Devuelve cuántas quedaron pendientes. */
export async function enqueueDfs(keywords: string[], ctx: VolumeCtx) {
  const { valid, rejected } = sanitizeKeywords(keywords);
  if (rejected.length) await jobLog("info", `DataForSEO: ${rejected.length} keywords no válidas para Google Ads, no se envían`, { rejected: rejected.slice(0, 50) });
  const originals = [...valid.values()].flat();
  // no duplicar pedidos ya pendientes/enviados para el mismo país+idioma
  const open = new Set(
    (await db.volumeRequest.findMany({ where: { status: { in: ["pending", "sent"] }, locationCode: ctx.locationCode, language: ctx.language, keyword: { in: originals } }, select: { keyword: true } })).map((r) => r.keyword)
  );
  const fresh = originals.filter((k) => !open.has(k));
  if (fresh.length) await db.volumeRequest.createMany({ data: fresh.map((keyword) => ({ keyword, country: ctx.country, language: ctx.language, locationCode: ctx.locationCode, projectId: ctx.projectId ?? null })) });
  return originals;
}

/** Junta pedidos pendientes de todos los proyectos y publica tasks de hasta 1.000 keywords. */
export async function flushDfsQueue(): Promise<number> {
  const pending = await db.volumeRequest.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: 50_000 });
  const groups = new Map<string, typeof pending>();
  for (const r of pending) groups.set(`${r.locationCode}|${r.language}`, [...(groups.get(`${r.locationCode}|${r.language}`) ?? []), r]);
  let tasks = 0;
  for (const rows of groups.values()) {
    const { locationCode, language } = rows[0];
    const byClean = new Map<string, typeof rows>();
    for (const r of rows) byClean.set(cleanKeyword(r.keyword), [...(byClean.get(cleanKeyword(r.keyword)) ?? []), r]);
    for (const batch of chunk([...byClean.keys()], 1000)) {
      const json = await post("/task_post", [{ keywords: batch, location_code: locationCode, language_code: language }]);
      const projects = [...new Set(batch.flatMap((k) => byClean.get(k)!.map((r) => r.projectId)).filter(Boolean))];
      await logCost("dataforseo", `search_volume/task_post (${env.dfsEnv})`, 1, { ref: `${batch.length} keywords, ${projects.length} proyecto(s)` });
      const task = json.tasks?.[0];
      const ids = batch.flatMap((k) => byClean.get(k)!.map((r) => r.id));
      if (!task?.id || (task.status_code && task.status_code >= 40000)) {
        await db.volumeRequest.updateMany({ where: { id: { in: ids } }, data: { status: "error" } });
        await jobLog("error", `DataForSEO task_post falló: ${task?.status_message ?? "sin id"}`, { keywords: batch.length });
        continue;
      }
      await db.volumeRequest.updateMany({ where: { id: { in: ids } }, data: { status: "sent", taskId: task.id } });
      await jobLog("info", `DataForSEO task ${task.id}: ${batch.length} keywords de ${projects.length} proyecto(s)`);
      tasks++;
    }
  }
  return tasks;
}

/** Revisa tasks enviados; guarda resultados en caché. Devuelve { done, waiting, keywords actualizadas }. */
export async function collectDfsQueue(writeCache: (rows: VolumeData[], country: string, language: string) => Promise<void>) {
  const sent = await db.volumeRequest.findMany({ where: { status: "sent" } });
  const byTask = new Map<string, typeof sent>();
  for (const r of sent) byTask.set(r.taskId!, [...(byTask.get(r.taskId!) ?? []), r]);
  let done = 0, waiting = 0;
  const touched: { country: string; language: string; keywords: string[] }[] = [];
  for (const [taskId, rows] of byTask) {
    const res = await fetchT(`${dfsBase()}${PATH}/task_get/${taskId}`, { headers: { Authorization: auth() }, timeoutMs: 60000 });
    if (!res.ok) { waiting++; continue; }
    const task = ((await res.json()) as any).tasks?.[0];
    // 40601 Task Handed / 40602 Task in Queue → aún no
    if (task?.status_code === 40601 || task?.status_code === 40602) { waiting++; continue; }
    if (task?.status_code !== 20000) {
      await db.volumeRequest.updateMany({ where: { taskId }, data: { status: "error" } });
      await jobLog("error", `DataForSEO task ${taskId}: ${task?.status_code} ${task?.status_message}`);
      continue;
    }
    const byClean = new Map<string, string[]>();
    for (const r of rows) byClean.set(cleanKeyword(r.keyword), [...(byClean.get(cleanKeyword(r.keyword)) ?? []), r.keyword]);
    const data = ((task.result ?? []) as Row[]).flatMap((r) => toData(r, [...new Set(byClean.get(String(r.keyword).toLowerCase()) ?? [])]));
    await writeCache(data, rows[0].country, rows[0].language);
    await db.volumeRequest.updateMany({ where: { taskId }, data: { status: "done" } });
    touched.push({ country: rows[0].country, language: rows[0].language, keywords: [...new Set(rows.map((r) => r.keyword))] });
    done++;
  }
  return { done, waiting, touched };
}

export class DataForSeoFetcher implements VolumeProvider {
  readonly source = "dataforseo" as const;
  constructor(private hooks: { kick?: () => Promise<void>; readCache?: (k: string[], ctx: VolumeCtx) => Promise<VolumeData[]> } = {}) {}

  unavailable() {
    return env.dfsLogin && env.dfsPassword ? null : "faltan DATAFORSEO_LOGIN/PASSWORD";
  }

  async fetch(keywords: string[], ctx: VolumeCtx): Promise<VolumeData[]> {
    if (ctx.live) return dfsLive(keywords, ctx);
    const queued = await enqueueDfs(keywords, ctx);
    await this.hooks.kick?.();
    // Espera acotada a la standard queue; lo que llegue después se aplica con el backfill.
    const deadline = Date.now() + env.dfsQueueWait * 1000;
    while (Date.now() < deadline) {
      const open = await db.volumeRequest.count({ where: { keyword: { in: queued }, locationCode: ctx.locationCode, language: ctx.language, status: { in: ["pending", "sent"] } } });
      if (!open) break;
      await sleep(3000);
    }
    const stillOpen = await db.volumeRequest.count({ where: { keyword: { in: queued }, locationCode: ctx.locationCode, language: ctx.language, status: { in: ["pending", "sent"] } } });
    if (stillOpen) await jobLog("info", `DataForSEO standard queue: ${stillOpen} keywords siguen en cola; se completan solas cuando lleguen`);
    return this.hooks.readCache ? this.hooks.readCache(queued, ctx) : [];
  }
}
