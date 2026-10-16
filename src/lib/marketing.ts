/**
 * Resultados para marketing: lo que hay que mirar cada semana para saber si el SEO está moviendo las métricas.
 *
 * - KPIs del período con marca / sin marca (lo que crece "solo" vs lo que trae el SEO).
 * - Rendimiento por sección (plantilla) y su variación.
 * - Objetivo mensual de clics con ritmo proyectado al fin de mes.
 * - Anotaciones (cambios publicados, tareas resueltas) con el efecto antes/después en Search Console.
 * - Contenido en caída sostenida (para refrescar) y valor estimado de las oportunidades 4–20.
 * - Competidores y cuota de visibilidad en las keywords monitoreadas; presencia en AI Overviews.
 *
 * Las funciones puras van arriba (testeables); `marketingOverview` arma todo desde la base.
 */
import { db } from "./db";
import { gscPeriod, isoDay, periodLabel, type GscPeriod } from "./gsc-period";
import { brandFromDomain, expectedCtrAt, isBrandQuery } from "./report-rules";
import { urlSection } from "./audit/insights";
import { hostOf, urlKey } from "./util";
import { ga4Overview } from "./ga4";

const DAY = 864e5;

// ---------- funciones puras ----------

/** Proyección lineal del mes: lo acumulado al ritmo diario actual hasta fin de mes. */
export function monthPace(mtd: number, daysWithData: number, daysInMonth: number, target: number | null) {
  const projected = daysWithData > 0 ? Math.round((mtd / daysWithData) * daysInMonth) : null;
  const status = target == null || projected == null ? null : projected >= target ? "en ritmo" : projected >= target * 0.9 ? "cerca" : "bajo el ritmo";
  // clics por día que faltan para llegar al objetivo
  const needPerDay = target != null && daysInMonth > daysWithData ? Math.max(0, Math.ceil((target - mtd) / (daysInMonth - daysWithData))) : null;
  return { mtd, projected, target, status, needPerDay, daysWithData, daysInMonth };
}

export type Window = { clicks: number; impressions: number; days: number };
/**
 * Efecto antes/después de un cambio: compara clics por día en ventanas iguales antes y después.
 * Con menos de 14 días después, o muy pocos clics, no concluye: lo dice.
 */
export function beforeAfter(before: Window, after: Window) {
  const perDay = (w: Window) => (w.days ? w.clicks / w.days : 0);
  const b = perDay(before), a = perDay(after);
  const change = b > 0 ? (a - b) / b : null;
  const conclusive = after.days >= 14 && before.clicks + after.clicks >= 30;
  return {
    beforePerDay: Math.round(b * 10) / 10,
    afterPerDay: Math.round(a * 10) / 10,
    impressionsBeforePerDay: Math.round((before.days ? before.impressions / before.days : 0) * 10) / 10,
    impressionsAfterPerDay: Math.round((after.days ? after.impressions / after.days : 0) * 10) / 10,
    change,
    conclusive,
    note: after.days < 14 ? `solo ${after.days} días de datos después del cambio: esperar al menos 14` : before.clicks + after.clicks < 30 ? "muy pocos clics para concluir" : "comparación simple: no descuenta estacionalidad ni otros cambios del mismo período",
  };
}

/** Caída sostenida: tres ventanas de 28 días seguidas bajando y al menos 30 % menos que al inicio. */
export function isDecaying(a: number, b: number, c: number, minClicks = 10) {
  return a >= minClicks && a > b && b > c && c <= a * 0.7;
}

/** Clics extra si la consulta llegara a la posición objetivo (curva de CTR promedio, no la del sitio). */
export function opportunityClicks(impressions: number, clicks: number, position: number, targetPos = 3) {
  if (position <= targetPos) return 0;
  return Math.max(0, Math.round(impressions * expectedCtrAt(targetPos) - clicks));
}

/** Cuota de visibilidad: CTR esperado de cada posición × volumen de la keyword, por dominio. */
export function shareOfVoice(serps: { keyword: string; volume: number; results: { domain: string; position: number }[] }[], own: string) {
  const by = new Map<string, { visibility: number; keywords: Set<string>; best: number; positions: number[] }>();
  let total = 0;
  for (const s of serps) {
    const vol = Math.max(1, s.volume);
    for (const r of s.results) {
      if (r.position > 20) continue;
      const d = r.domain.replace(/^www\./, "");
      const v = expectedCtrAt(r.position) * vol;
      total += v;
      const e = by.get(d) ?? { visibility: 0, keywords: new Set<string>(), best: 99, positions: [] };
      e.visibility += v;
      e.keywords.add(s.keyword);
      e.best = Math.min(e.best, r.position);
      e.positions.push(r.position);
      by.set(d, e);
    }
  }
  const ownD = own.replace(/^www\./, "");
  const rows = [...by.entries()]
    .map(([domain, e]) => ({
      domain,
      share: total ? e.visibility / total : 0,
      keywords: e.keywords.size,
      avgPosition: e.positions.reduce((a, b) => a + b, 0) / e.positions.length,
      own: domain === ownD || domain.endsWith(`.${ownD}`),
    }))
    .sort((a, b) => b.share - a.share);
  return { rows, ownShare: rows.filter((r) => r.own).reduce((s, r) => s + r.share, 0), keywords: serps.length };
}

/** ¿El dominio aparece citado en el AI Overview? (busca el dominio en las fuentes/links guardados) */
export function citedInAiOverview(ai: unknown, domain: string) {
  if (!ai) return false;
  const d = domain.replace(/^www\./, "").toLowerCase();
  return JSON.stringify(ai).toLowerCase().includes(d);
}

/** Alcance de una anotación: URL exacta, sección (/blog/*) o todo el sitio. */
export function inScope(page: string, scope: string | null | undefined) {
  if (!scope) return true;
  if (/^https?:\/\//.test(scope)) return urlKey(page) === urlKey(scope);
  const sec = scope.startsWith("/") ? scope : `/${scope}`;
  if (sec.endsWith("/*")) return urlSection(page) === sec || urlSection(page).startsWith(sec.slice(0, -1));
  try {
    return new URL(page).pathname.replace(/\/+$/, "") === sec.replace(/\/+$/, "");
  } catch {
    return false;
  }
}

// ---------- base de datos ----------

type Goals = { clicks?: number | null; nonBrandClicks?: number | null };
export const goalsOf = (settings: unknown): Goals => ((settings as any)?.marketing?.goals ?? {}) as Goals;

async function scopedWindow(projectId: string, scope: string | null, from: Date, to: Date): Promise<Window> {
  const days = Math.max(0, Math.round((to.getTime() - from.getTime()) / DAY));
  if (!days) return { clicks: 0, impressions: 0, days: 0 };
  if (!scope) {
    const r = await db.gscDay.aggregate({ where: { projectId, date: { gte: from, lt: to } }, _sum: { clicks: true, impressions: true }, _count: true });
    if (r._count) return { clicks: r._sum.clicks ?? 0, impressions: r._sum.impressions ?? 0, days };
  }
  const rows = await db.gscRow.groupBy({ by: ["page"], where: { projectId, date: { gte: from, lt: to } }, _sum: { clicks: true, impressions: true } });
  const sel = rows.filter((r) => inScope(r.page, scope));
  return { clicks: sel.reduce((s, r) => s + (r._sum.clicks ?? 0), 0), impressions: sel.reduce((s, r) => s + (r._sum.impressions ?? 0), 0), days };
}

/** Efecto de un cambio en su alcance, con ventanas iguales (máx. 28 días) a cada lado de la fecha. */
export async function annotationImpact(projectId: string, period: GscPeriod, date: Date, scope: string | null) {
  const afterDays = Math.min(28, Math.floor((period.endExclusive.getTime() - date.getTime()) / DAY) - 1);
  if (afterDays <= 0) return { ...beforeAfter({ clicks: 0, impressions: 0, days: 0 }, { clicks: 0, impressions: 0, days: 0 }), note: "todavía no hay datos de Search Console posteriores al cambio" };
  // el día del cambio no cuenta para ningún lado
  const afterStart = new Date(date.getTime() + DAY);
  const [before, after] = await Promise.all([
    scopedWindow(projectId, scope, new Date(date.getTime() - afterDays * DAY), date),
    scopedWindow(projectId, scope, afterStart, new Date(afterStart.getTime() + afterDays * DAY)),
  ]);
  return beforeAfter(before, after);
}

export async function marketingOverview(projectId: string) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const period = await gscPeriod(projectId);
  const brand = brandFromDomain(p.domain);
  const own = hostOf(`https://${p.domain}`);
  const goals = goalsOf(p.settings);
  const annotations = await db.annotation.findMany({ where: { projectId }, orderBy: { date: "desc" }, take: 50 });

  const competitors = await competitorsOverview(projectId, own);
  if (!period) return { connected: false as const, goals, annotations: annotations.map((a) => ({ ...a, impact: null })), competitors, ga4: await ga4Overview(projectId, null) };

  const cur = { gte: period.start, lt: period.endExclusive };
  const prev = { gte: period.prevStart, lt: period.start };
  const [dayCur, dayPrev, qCur, qPrev, pCur, pPrev] = await Promise.all([
    db.gscDay.aggregate({ where: { projectId, date: cur }, _sum: { clicks: true, impressions: true }, _count: true }),
    db.gscDay.aggregate({ where: { projectId, date: prev }, _sum: { clicks: true, impressions: true } }),
    db.gscRow.groupBy({ by: ["query"], where: { projectId, date: cur }, _sum: { clicks: true, impressions: true } }),
    db.gscRow.groupBy({ by: ["query"], where: { projectId, date: prev }, _sum: { clicks: true, impressions: true } }),
    db.gscRow.groupBy({ by: ["page"], where: { projectId, date: cur }, _sum: { clicks: true, impressions: true } }),
    db.gscRow.groupBy({ by: ["page"], where: { projectId, date: prev }, _sum: { clicks: true, impressions: true } }),
  ]);
  const split = (rows: typeof qCur) => {
    const o = { brand: { clicks: 0, impressions: 0 }, nonBrand: { clicks: 0, impressions: 0 } };
    for (const r of rows) {
      const k = isBrandQuery(r.query, brand) ? o.brand : o.nonBrand;
      k.clicks += r._sum.clicks ?? 0;
      k.impressions += r._sum.impressions ?? 0;
    }
    return o;
  };
  const sCur = split(qCur), sPrev = split(qPrev);
  const totalsFromDays = dayCur._count > 0;
  const sum = (rows: typeof pCur, k: "clicks" | "impressions") => rows.reduce((s, r) => s + (r._sum[k] ?? 0), 0);
  const kpis = {
    period: { start: isoDay(period.start), end: isoDay(period.end), label: periodLabel(period, totalsFromDays ? "totals" : "rows") },
    clicks: { now: totalsFromDays ? dayCur._sum.clicks ?? 0 : sum(pCur, "clicks"), before: totalsFromDays ? dayPrev._sum.clicks ?? 0 : sum(pPrev, "clicks") },
    impressions: { now: totalsFromDays ? dayCur._sum.impressions ?? 0 : sum(pCur, "impressions"), before: totalsFromDays ? dayPrev._sum.impressions ?? 0 : sum(pPrev, "impressions") },
    brand: { now: sCur.brand.clicks, before: sPrev.brand.clicks },
    nonBrand: { now: sCur.nonBrand.clicks, before: sPrev.nonBrand.clicks },
    nonBrandImpressions: { now: sCur.nonBrand.impressions, before: sPrev.nonBrand.impressions },
    // clics que Search Console no asigna a ninguna consulta (anonimizadas): no son de marca ni sin marca, son desconocidos
    unclassified: totalsFromDays
      ? { now: Math.max(0, (dayCur._sum.clicks ?? 0) - sCur.brand.clicks - sCur.nonBrand.clicks), before: Math.max(0, (dayPrev._sum.clicks ?? 0) - sPrev.brand.clicks - sPrev.nonBrand.clicks) }
      : { now: 0, before: 0 },
    source: totalsFromDays ? "Totales: Search Console del sitio. Marca / sin marca: filas por consulta (sin consultas anonimizadas)." : "Filas por consulta y página de Search Console (sin consultas anonimizadas).",
  };

  // por sección
  const secMap = new Map<string, { clicks: number; impressions: number; before: number; pages: number }>();
  for (const r of pCur) {
    const s = urlSection(r.page);
    const e = secMap.get(s) ?? { clicks: 0, impressions: 0, before: 0, pages: 0 };
    e.clicks += r._sum.clicks ?? 0;
    e.impressions += r._sum.impressions ?? 0;
    e.pages++;
    secMap.set(s, e);
  }
  for (const r of pPrev) {
    const s = urlSection(r.page);
    const e = secMap.get(s) ?? { clicks: 0, impressions: 0, before: 0, pages: 0 };
    e.before += r._sum.clicks ?? 0;
    secMap.set(s, e);
  }
  const sections = [...secMap.entries()].map(([section, e]) => ({ section, ...e })).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 15);

  // objetivo del mes calendario del último dato
  const mStart = new Date(Date.UTC(period.end.getUTCFullYear(), period.end.getUTCMonth(), 1));
  const daysInMonth = new Date(Date.UTC(period.end.getUTCFullYear(), period.end.getUTCMonth() + 1, 0)).getUTCDate();
  const daysWithData = period.end.getUTCDate();
  const [mDay, mRows] = await Promise.all([
    db.gscDay.aggregate({ where: { projectId, date: { gte: mStart, lt: period.endExclusive } }, _sum: { clicks: true }, _count: true }),
    db.gscRow.groupBy({ by: ["query"], where: { projectId, date: { gte: mStart, lt: period.endExclusive } }, _sum: { clicks: true } }),
  ]);
  const mtdNonBrand = mRows.filter((r) => !isBrandQuery(r.query, brand)).reduce((s, r) => s + (r._sum.clicks ?? 0), 0);
  const mtdClicks = mDay._count ? mDay._sum.clicks ?? 0 : mRows.reduce((s, r) => s + (r._sum.clicks ?? 0), 0);
  const goalProgress = {
    month: isoDay(mStart).slice(0, 7),
    clicks: monthPace(mtdClicks, daysWithData, daysInMonth, goals.clicks ?? null),
    nonBrandClicks: monthPace(mtdNonBrand, daysWithData, daysInMonth, goals.nonBrandClicks ?? null),
  };

  // anotaciones manuales + tareas resueltas (medición posterior de correcciones)
  const resolved = await db.projectTask.findMany({
    where: { projectId, status: "resolved", resolvedAt: { gte: new Date(period.end.getTime() - 180 * DAY) }, url: { not: null } },
    orderBy: { resolvedAt: "desc" },
    take: 15,
    select: { id: true, title: true, url: true, resolvedAt: true },
  });
  const changes = [
    ...annotations.map((a) => ({ id: a.id, kind: "manual" as const, date: a.date, title: a.title, scope: a.scope, note: a.note })),
    ...resolved.map((t) => ({ id: t.id, kind: "task" as const, date: new Date(Date.UTC(t.resolvedAt!.getUTCFullYear(), t.resolvedAt!.getUTCMonth(), t.resolvedAt!.getUTCDate())), title: `Resuelto: ${t.title}`, scope: t.url, note: null })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 30);
  const withImpact = await Promise.all(changes.map(async (c) => ({ ...c, date: isoDay(c.date), impact: await annotationImpact(projectId, period, c.date, c.scope) })));

  // contenido en caída sostenida: 3 ventanas de 28 días
  const w = (k: number) => ({ gte: new Date(period.start.getTime() - k * 28 * DAY), lt: new Date(period.endExclusive.getTime() - k * 28 * DAY) });
  const [w2, w1] = await Promise.all([
    db.gscRow.groupBy({ by: ["page"], where: { projectId, date: w(2) }, _sum: { clicks: true } }),
    db.gscRow.groupBy({ by: ["page"], where: { projectId, date: w(1) }, _sum: { clicks: true } }),
  ]);
  const m2 = new Map(w2.map((r) => [r.page, r._sum.clicks ?? 0])), m1 = new Map(w1.map((r) => [r.page, r._sum.clicks ?? 0]));
  const m0 = new Map(pCur.map((r) => [r.page, r._sum.clicks ?? 0]));
  const decay = [...m2.entries()]
    .map(([page, a]) => ({ page, a, b: m1.get(page) ?? 0, c: m0.get(page) ?? 0 }))
    .filter((x) => isDecaying(x.a, x.b, x.c))
    .sort((x, y) => y.a - y.c - (x.a - x.c))
    .slice(0, 15)
    .map((x) => ({ page: x.page, clicks: [x.a, x.b, x.c], lost: x.a - x.c }));

  // valor de las oportunidades 4–20 (sin marca)
  const qp = await db.gscRow.groupBy({ by: ["query", "page"], where: { projectId, date: cur }, _sum: { clicks: true, impressions: true }, _avg: { position: true } });
  const opportunities = qp
    .filter((r) => !isBrandQuery(r.query, brand) && (r._avg.position ?? 99) > 3 && (r._avg.position ?? 99) <= 20 && (r._sum.impressions ?? 0) >= 20)
    .map((r) => ({ query: r.query, page: r.page, impressions: r._sum.impressions ?? 0, clicks: r._sum.clicks ?? 0, position: Math.round((r._avg.position ?? 0) * 10) / 10, extraClicks: opportunityClicks(r._sum.impressions ?? 0, r._sum.clicks ?? 0, r._avg.position ?? 99) }))
    .filter((r) => r.extraClicks > 0)
    .sort((a, b) => b.extraClicks - a.extraClicks)
    .slice(0, 25);

  return {
    connected: true as const,
    kpis,
    sections,
    goals,
    goalProgress,
    annotations: withImpact,
    decay,
    opportunities: { rows: opportunities, extraClicks: opportunities.reduce((s, r) => s + r.extraClicks, 0), note: "Clics extra estimados si cada consulta llegara a la posición 3, con una curva de CTR promedio de la industria. Es un orden de magnitud para priorizar, no una promesa." },
    competitors,
    ga4: await ga4Overview(projectId, period),
  };
}

/** Competidores y presencia en AI Overviews a partir de las últimas SERPs guardadas (rankings y research). */
export async function competitorsOverview(projectId: string, own: string) {
  const tracked = await db.trackedKeyword.findMany({ where: { projectId, active: true }, select: { keyword: true } });
  const terms = tracked.map((t) => t.keyword);
  const snaps = await db.serpSnapshot.findMany({
    where: { projectId, ...(terms.length ? { keyword: { in: terms } } : {}) },
    orderBy: { fetchedAt: "desc" },
    take: 500,
    select: { keyword: true, organic: true, aiOverview: true, features: true, fetchedAt: true },
  });
  const latest = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) if (!latest.has(s.keyword)) latest.set(s.keyword, s);
  if (!latest.size) return null;
  const vols = await db.keyword.findMany({ where: { projectId, term: { in: [...latest.keys()] } }, select: { term: true, volume: true } });
  const volOf = new Map(vols.map((v) => [v.term, v.volume ?? 0]));
  const sov = shareOfVoice(
    [...latest.values()].map((s) => ({ keyword: s.keyword, volume: volOf.get(s.keyword) ?? 0, results: ((s.organic as any[]) ?? []).map((o) => ({ domain: String(o.domain ?? hostOf(o.url)), position: Number(o.position) })) })),
    own
  );
  const ai = [...latest.values()].filter((s) => s.aiOverview);
  return {
    basis: terms.length ? "keywords monitoreadas en Rankings" : "SERPs guardadas por research, contenido o rankings",
    // con pocas keywords la cuota describe esas consultas, no el mercado
    representative: latest.size >= 10,
    keywords: latest.size,
    ownShare: sov.ownShare,
    top: sov.rows.slice(0, 12),
    aiOverview: {
      keywords: ai.length,
      cited: ai.filter((s) => citedInAiOverview(s.aiOverview, own)).length,
      examples: ai.slice(0, 8).map((s) => ({ keyword: s.keyword, cited: citedInAiOverview(s.aiOverview, own) })),
    },
    note: "Visibilidad = CTR esperado de cada posición × volumen de búsqueda (o 1 si no hay volumen), sumado por dominio en el top 20.",
  };
}
