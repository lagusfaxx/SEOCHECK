import { db } from "./db";
import { serpProvider, type Serp } from "./providers";

/** SERP Deep (1 página) con caché en Postgres (por defecto 7 días). Para research y content. */
export async function getSerp(projectId: string, keyword: string, opts: { country: string; language: string; depth?: number; maxAgeHours?: number }): Promise<Serp> {
  const depth = opts.depth ?? 10;
  const since = new Date(Date.now() - (opts.maxAgeHours ?? 24 * 7) * 3600_000);
  const cached = await db.serpSnapshot.findFirst({
    where: { projectId, keyword, source: "deep", depth: { gte: depth }, fetchedAt: { gte: since } },
    orderBy: { fetchedAt: "desc" },
  });
  if (cached) {
    return { keyword, organic: cached.organic as Serp["organic"], paa: cached.paa, related: cached.related, features: cached.features, aiOverview: cached.aiOverview };
  }
  const serp = await serpProvider().deep(keyword, { country: opts.country, language: opts.language, projectId });
  await db.serpSnapshot.create({
    data: { projectId, keyword, depth, organic: serp.organic, paa: serp.paa, related: serp.related, features: serp.features, aiOverview: (serp.aiOverview ?? undefined) as any },
  });
  return serp;
}
