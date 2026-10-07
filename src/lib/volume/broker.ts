import { db } from "../db";
import { env } from "../env";
import { jobLog } from "../jobctx";
import { getBoss, QUEUES } from "../queue";
import { kwScore } from "../keywords/cluster";
import { normTerm } from "../util";
import { ApifyFetcher } from "./apify";
import { DataForSeoFetcher } from "./dataforseo";
import type { VolumeCtx, VolumeData, VolumeProvider, VolumeSource } from "./types";
import { markProvider, markProviderOk, NoBalanceError, providerBlocked } from "./state";

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

export function fetcherFor(name: string): VolumeProvider | null {
  if (name === "dataforseo")
    return new DataForSeoFetcher({ kick: kickDfs, readCache: async (k, ctx) => [...(await readCache(k, ctx, "dataforseo")).values()].filter((v) => v.source === "dataforseo") });
  if (name === "apify") return new ApifyFetcher();
  return null; // csv: solo lo importado (está en la caché)
}

export type ChainStatus = { provider: string; available: boolean; reason: string | null };

/** Estado de cada proveedor de la cadena (para la UI y diagnóstico). */
export async function volumeChainStatus(): Promise<ChainStatus[]> {
  const out: ChainStatus[] = [];
  for (const name of env.volumeProviders) {
    if (name === "csv") { out.push({ provider: "csv", available: true, reason: null }); continue; }
    const why = fetcherFor(name)?.unavailable() ?? (await providerBlocked(name));
    out.push({ provider: name, available: !why, reason: why });
  }
  return out;
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
 * Volumen por keyword. Prioridad: impresiones GSC > cadena VOLUME_PROVIDERS (def. dataforseo,apify,csv) > null.
 * Primero la caché global (< 30 días); lo que falta se pide al primer proveedor utilizable de la cadena.
 * Un proveedor sin credenciales o sin saldo (402 / 40200 / 40210) se salta y se usa el siguiente.
 * Lo que el proveedor elegido no devuelve queda null: no se pregunta a los demás.
 */
export async function resolveVolumes(keywords: string[], ctx: VolumeCtx): Promise<{ data: Map<string, ResolvedVolume>; stats: Record<string, any> }> {
  const keys = [...new Set(keywords.map(volKey))];
  const out = new Map<string, ResolvedVolume>();
  const chain = env.volumeProviders;
  const stats: Record<string, any> = { chain: chain.join(","), skipped: [] as string[] };

  const cached = await readCache(keys, ctx, chain[0]);
  stats.cache = cached.size;
  for (const [k, v] of cached) out.set(k, v);

  const misses = keys.filter((k) => !cached.has(k));
  if (misses.length) {
    for (const name of chain) {
      if (name === "csv") {
        stats.provider = "csv";
        break; // solo volúmenes importados (ya leídos desde la caché)
      }
      const fetcher = fetcherFor(name)!;
      const why = fetcher.unavailable() ?? (await providerBlocked(name));
      if (why) {
        stats.skipped.push(`${name}: ${why}`);
        continue;
      }
      try {
        const got = await fetcher.fetch(misses, ctx);
        const viaQueue = name === "dataforseo" && !(ctx.live ?? env.dfsMode === "live");
        if (!viaQueue) await writeCache(got, ctx.country, ctx.language, fetcher.source); // la queue ya escribe la caché
        await markProviderOk(name);
        const now = new Date();
        for (const g of got) out.set(volKey(g.keyword), { ...g, keyword: volKey(g.keyword), source: fetcher.source, at: now });
        stats.provider = name;
        stats.fetched = got.length;
        break;
      } catch (e) {
        if (e instanceof NoBalanceError) {
          await markProvider(name, e.status, e.message);
          stats.skipped.push(`${name}: ${e.status === "no_balance" ? "sin saldo" : "credenciales inválidas"}`);
          continue;
        }
        await jobLog("error", `volumen (${name}) falló: ${e instanceof Error ? e.message : e}`);
        stats.error = e instanceof Error ? e.message : String(e);
        stats.provider = name;
        break;
      }
    }
    if (stats.skipped.length) await jobLog("warn", `volumen: proveedores saltados → ${stats.skipped.join("; ")}${stats.provider ? `; se usó ${stats.provider}` : "; ninguno disponible"}`);
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
  const cache = await readCache(keywords, { country, language }, env.volumeProviders[0]);
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
