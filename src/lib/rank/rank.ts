import { db } from "../db";
import { serpProvider } from "../providers";
import { hostOf } from "../util";

export async function checkRank(trackedId: string) {
  const t = await db.trackedKeyword.findUniqueOrThrow({ where: { id: trackedId }, include: { project: true } });
  const p = t.project;
  const own = hostOf(p.domain);
  // Quick con num=100: una sola unidad facturada por keyword, top 100 completo.
  const serp = await serpProvider().quick(t.keyword, { country: p.country, language: p.language, projectId: p.id, num: 100 });
  await db.serpSnapshot.create({ data: { projectId: p.id, keyword: t.keyword, depth: 100, source: "quick", organic: serp.organic, paa: serp.paa, related: serp.related, features: serp.features, aiOverview: (serp.aiOverview ?? undefined) as any } });
  const hit = serp.organic.find((o) => o.domain === own || o.domain.endsWith("." + own));
  const competitors = serp.organic.slice(0, 10).filter((o) => o.domain !== own).map((o) => ({ domain: o.domain, position: o.position, url: o.url }));
  return db.rankCheck.create({
    data: { trackedId, position: hit?.position ?? null, url: hit?.url ?? null, features: serp.features, competitors },
  });
}

/** Keywords que tocan hoy (daily siempre; weekly los lunes). */
export async function dueTracked(projectId?: string) {
  const monday = new Date().getDay() === 1;
  return db.trackedKeyword.findMany({
    where: { active: true, ...(projectId ? { projectId } : {}), ...(monday ? {} : { frequency: "daily" }) },
  });
}
