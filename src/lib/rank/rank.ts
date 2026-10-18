import { assertPlanActive, resolvePlan } from "../plans";
import { db } from "../db";
import { env } from "../env";
import { serpProvider } from "../providers";
import { hostOf } from "../util";

export async function checkRank(trackedId: string) {
  const t = await db.trackedKeyword.findUniqueOrThrow({ where: { id: trackedId }, include: { project: true } });
  const p = t.project;
  await assertPlanActive(p.id);
  const own = hostOf(p.domain);
  // Quick con num=100: una sola unidad facturada por keyword, top 100 completo.
  const serp = await serpProvider().quick(t.keyword, { country: p.country, language: p.language, projectId: p.id, num: 100 });
  await db.serpSnapshot.create({ data: { projectId: p.id, keyword: t.keyword, depth: 100, source: "quick", organic: serp.organic, paa: serp.paa, related: serp.related, features: serp.features, aiOverview: (serp.aiOverview ?? undefined) as any } });
  // el mismo criterio para «es mío» en todo: www.sitio.cl no es un competidor de sitio.cl
  const isOwn = (d: string) => d === own || d.endsWith("." + own);
  const hit = serp.organic.find((o) => isOwn(o.domain));
  // el top 10 completo: las otras URLs propias quedan marcadas (dos páginas tuyas por la misma búsqueda se ven aquí)
  const competitors = serp.organic
    .slice(0, 10)
    .filter((o) => o !== hit)
    .map((o) => ({ domain: o.domain, position: o.position, url: o.url, ...(isOwn(o.domain) ? { own: true } : {}) }));
  return db.rankCheck.create({
    data: { trackedId, position: hit?.position ?? null, url: hit?.url ?? null, features: serp.features, competitors },
  });
}

/** Keywords que tocan hoy: daily siempre; weekly el día RANK_WEEKDAY (0=domingo … 1=lunes, def. lunes) en TZ. */
export async function dueTracked(projectId?: string, now = new Date()) {
  const weekday = Number(process.env.RANK_WEEKDAY ?? 1);
  const today = new Date(now.toLocaleString("en-US", { timeZone: env.tz })).getDay();
  const due = await db.trackedKeyword.findMany({
    where: { active: true, ...(projectId ? { projectId } : {}), ...(today === weekday ? {} : { frequency: "daily" }) },
    include: { project: { select: { workspace: true } } },
  });
  // planes vencidos (prueba terminada, pago caído): no se sigue pagando su seguimiento
  const active = new Map<string, boolean>();
  return due
    .filter((t) => {
      const w = t.project.workspace;
      if (!active.has(w.id)) active.set(w.id, !resolvePlan(w).expired);
      return active.get(w.id);
    })
    .map(({ project: _p, ...t }) => t);
}
