import { db } from "./db";
import { serpProvider, type Serp } from "./providers";
import { ProviderError } from "./providers/errors";
import { jobLog } from "./jobctx";

type Snap = { organic: unknown; paa: string[]; related: string[]; features: string[]; aiOverview: unknown };
const fromSnap = (keyword: string, c: Snap): Serp => ({ keyword, organic: c.organic as Serp["organic"], paa: c.paa, related: c.related, features: c.features, aiOverview: c.aiOverview as Serp["aiOverview"] });

/**
 * SERP Deep (1 página) con caché en Postgres (por defecto 7 días). Para research y content.
 * Si Serpent falla de forma transitoria (caído, timeout, 429) y hay un snapshot más viejo, se usa ése.
 */
type SerpQ = { country: string; language: string; depth?: number; maxAgeHours?: number };
export async function getSerp(projectId: string, keyword: string, opts: SerpQ & { cacheOnly?: false }): Promise<Serp>;
/** cacheOnly: sólo snapshot (de cualquier antigüedad), sin llamar a la API; null si no hay. */
export async function getSerp(projectId: string, keyword: string, opts: SerpQ & { cacheOnly: true }): Promise<Serp | null>;
export async function getSerp(projectId: string, keyword: string, opts: SerpQ & { cacheOnly?: boolean }): Promise<Serp | null> {
  const depth = opts.depth ?? 10;
  const since = new Date(Date.now() - (opts.maxAgeHours ?? 24 * 7) * 3600_000);
  const cached = await db.serpSnapshot.findFirst({
    where: { projectId, keyword, source: "deep", depth: { gte: depth }, fetchedAt: { gte: since } },
    orderBy: { fetchedAt: "desc" },
  });
  if (cached) return fromSnap(keyword, cached);
  const stale = () => db.serpSnapshot.findFirst({ where: { projectId, keyword, source: "deep", depth: { gte: depth } }, orderBy: { fetchedAt: "desc" } });
  if (opts.cacheOnly) {
    const old = await stale();
    return old ? fromSnap(keyword, old) : null;
  }
  let serp: Serp;
  try {
    serp = await serpProvider().deep(keyword, { country: opts.country, language: opts.language, projectId });
  } catch (e) {
    if (!(e instanceof ProviderError && e.transient)) throw e;
    const old = await stale();
    if (!old) throw e;
    await jobLog("warn", `${e.message}; se usa la SERP en caché de "${keyword}" del ${old.fetchedAt.toISOString().slice(0, 10)}`);
    return fromSnap(keyword, old);
  }
  await db.serpSnapshot.create({
    data: { projectId, keyword, depth, organic: serp.organic, paa: serp.paa, related: serp.related, features: serp.features, aiOverview: (serp.aiOverview ?? undefined) as any },
  });
  return serp;
}
