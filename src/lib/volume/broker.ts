import { db } from "../db";
import { env } from "../env";
import { jobLog } from "../jobctx";
import { getBoss, QUEUES } from "../queue";
import { kwScore } from "../keywords/cluster";
import { normTerm } from "../util";
import { ApifyFetcher } from "./apify";
import { DataForSeoFetcher } from "./dataforseo";
import type { VolumeCtx, VolumeData, VolumeProvider, VolumeSource } from "./types";

export const CACHE_DAYS = 30;
export const volKey = (k: string) => normTerm(k.normalize("NFC"));

export type ResolvedVolume = VolumeData & { source: VolumeSource; at: Date };

/** Caché global: país + idioma + keyword normalizada, cualquier proyecto, < 30 días. */
export async function readCache(keywords: string[], ctx: Pick<VolumeCtx, "country" | "language">, prefer?: string): Promise<Map<string, ResolvedVolume>> {
  const keys = [...new Set(keywords.map(volKey))];
  const since = new Date(Date.now() - CACHE_DAYS * 864e5);
  const rows = keys.length
    ? await db.volumeCache.findMany({ where: { country: ctx.country, language: ctx.language, keyword: { in: keys }, fetchedAt: { gte: since } }, orderBy: { fetchedAt: "desc" } })
    : [];
  const out = new Map<string, ResolvedVolume>();
  for (const r of rows) {
    const cur = out.get(r.keyword);
    if (cur && !(prefer && r.source === prefer && cur.source !== prefer)) continue;
    out.set(r.keyword, { keyword: r.keyword, volume: r.volume, volumeMin: r.volumeMin, volumeMax: r.volumeMax, cpc: r.cpc, competition: r.competition, intent: r.intent, source: r.source as VolumeSource, at: r.fetchedAt });
  }
  return out;
}

export async function writeCache(rows: VolumeData[], country: string, language: string, source: Exclude<VolumeSource, "gsc">) {
  const now = new Date();
  for (const r of rows) {
    const keyword = volKey(r.keyword);
    const data = { volume: r.volume, volumeMin: r.volumeMin ?? null, volumeMax: r.volumeMax ?? null, cpc: r.cpc, competition: r.competition, intent: r.intent ?? null, fetchedAt: now };
    await db.volumeCache.upsert({ where: { country_language_keyword_source: { country, language, keyword, source } }, create: { country, language, keyword, source, ...data }, update: data });
  }
}

/** Arranca (con debounce) el flush de la standard queue para juntar keywords de varios proyectos. */
async function kickDfs() {
  const boss = await getBoss();
  await boss.send(QUEUES.dfsFlush, {}, { singletonKey: "dfs-flush", startAfter: 10 });
}

export function fetcherFor(name: string = env.volumeProvider): VolumeProvider | null {
  if (name === "dataforseo")
    return new DataForSeoFetcher({ kick: kickDfs, readCache: async (k, ctx) => [...(await readCache(k, ctx, "dataforseo")).values()].filter((v) => v.source === "dataforseo") });
  if (name === "apify") return new ApifyFetcher();
  return null; // csv: solo lo importado (está en la caché)
}

/** Estado del provider configurado (para badges/diagnóstico). */
export function volumeProviderStatus() {
  const f = fetcherFor();
  return { provider: env.volumeProvider, available: env.volumeProvider === "csv" ? true : f ? f.unavailable() == null : false, reason: f?.unavailable() ?? null };
}

/** Impresiones GSC (28 días) por query del proyecto. */
export async function gscImpressions(projectId: string, keywords: string[]): Promise<Map<string, number>> {
  const keys = [...new Set(keywords.map(volKey))];
  if (!keys.length) return new Map();
  const since = new Date(Date.now() - 30 * 864e5);
  const rows = await db.gscRow.groupBy({ by: ["query"], where: { projectId, date: { gte: since }, query: { in: keys } }, _sum: { impressions: true } });
  return new Map(rows.filter((r) => (r._sum.impressions ?? 0) > 0).map((r) => [volKey(r.query), r._sum.impressions!]));
}

/**
 * Volumen por keyword. Prioridad: impresiones GSC > VOLUME_PROVIDER (caché < 30 días o consulta) > null.
 * Solo se consulta al proveedor lo que no está en caché.
 */
export async function resolveVolumes(keywords: string[], ctx: VolumeCtx): Promise<{ data: Map<string, ResolvedVolume>; stats: Record<string, number | string> }> {
  const keys = [...new Set(keywords.map(volKey))];
  const out = new Map<string, ResolvedVolume>();
  const stats: Record<string, number | string> = { provider: env.volumeProvider };

  const cached = await readCache(keys, ctx, env.volumeProvider);
  stats.cache = cached.size;
  for (const [k, v] of cached) out.set(k, v);

  const misses = keys.filter((k) => !cached.has(k));
  const fetcher = fetcherFor();
  const why = env.volumeProvider === "csv" ? "csv: solo volúmenes importados" : fetcher?.unavailable();
  if (misses.length && fetcher && !why) {
    try {
      const got = await fetcher.fetch(misses, ctx);
      if (fetcher.source !== "dataforseo" || ctx.live) await writeCache(got, ctx.country, ctx.language, fetcher.source); // la queue ya escribe la caché
      const now = new Date();
      for (const g of got) out.set(volKey(g.keyword), { ...g, keyword: volKey(g.keyword), source: fetcher.source, at: now });
      stats.fetched = got.length;
    } catch (e) {
      await jobLog("error", `volumen (${fetcher.source}) falló: ${e instanceof Error ? e.message : e}`);
      stats.error = e instanceof Error ? e.message : String(e);
    }
  } else if (misses.length) {
    stats.skipped = misses.length;
    if (why) await jobLog("info", `volumen: ${misses.length} keywords sin dato (${why})`);
  }

  // GSC manda sobre el proveedor
  if (ctx.projectId) {
    const gsc = await gscImpressions(ctx.projectId, keys);
    const now = new Date();
    for (const [k, impressions] of gsc) {
      const prev = out.get(k);
      out.set(k, { keyword: k, volume: impressions, volumeMin: null, volumeMax: null, cpc: prev?.cpc ?? null, competition: prev?.competition ?? null, intent: prev?.intent ?? null, source: "gsc", at: now });
    }
    stats.gsc = gsc.size;
  }
  stats.missing = keys.filter((k) => !out.has(k)).length;
  return { data: out, stats };
}

/** Aplica a las keywords de todos los proyectos los volúmenes que llegaron después (standard queue / CSV). */
export async function backfillVolumes(country: string, language: string, keywords: string[]) {
  const cache = await readCache(keywords, { country, language }, env.volumeProvider);
  if (!cache.size) return 0;
  const projects = await db.project.findMany({ where: { country, language }, select: { id: true } });
  let n = 0;
  const clusters = new Set<string>();
  for (const k of await db.keyword.findMany({ where: { projectId: { in: projects.map((p) => p.id) }, term: { in: [...cache.keys()] }, OR: [{ volumeSource: null }, { volumeSource: { not: "gsc" } }] } })) {
    const v = cache.get(volKey(k.term))!;
    await db.keyword.update({
      where: { id: k.id },
      data: {
        volume: v.volume, volumeMin: v.volumeMin ?? null, volumeMax: v.volumeMax ?? null, volumeSource: v.source, volumeAt: v.at,
        cpc: v.cpc ?? k.cpc, competition: v.competition ?? k.competition,
        score: v.volume != null ? kwScore(v.volume, k.relevance ?? 0, k.difficulty ?? 50) : null,
      },
    });
    if (k.clusterId) clusters.add(k.clusterId);
    n++;
  }
  for (const c of clusters) {
    const kws = await db.keyword.findMany({ where: { clusterId: c } });
    await db.cluster.update({ where: { id: c }, data: { volume: kws.reduce((s, x) => s + (x.volume ?? 0), 0), score: kws.reduce((s, x) => s + (x.score ?? 0), 0) } }).catch(() => {});
  }
  return n;
}
