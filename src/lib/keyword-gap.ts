/**
 * Keyword gap y estacionalidad con la cuenta DataForSEO del servidor.
 *
 * - Gap: keywords por las que cada competidor está en el top 20 y el sitio no aparece (DataForSEO Labs,
 *   domain_intersection con intersections=false). Una foto cada 30 días: los datos de Labs se actualizan por mes.
 * - Estacionalidad: con las búsquedas por mes (de Labs y del volumen de keywords) se marcan los meses pico de cada
 *   tema, para publicar o actualizar el contenido antes de que suba la demanda.
 */
import { db } from "./db";
import { logCost } from "./costs";
import { fetchT, hostOf } from "./util";
import { dfsAuth, dfsBase, dfsAccountError } from "./volume/dataforseo";
import { assertBudget } from "./budget";
import { backlinksConfigured, bareDomain, pickCompetitors } from "./backlinks";
import { competitorsOverview } from "./marketing";
import { siteVocabulary, topicWords } from "./keyword-triage";

const DAY = 864e5;
export const GAP_REFRESH_DAYS = 30;
export const GAP_USD_ESTIMATE = 0.15;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export type Monthly = { year: number; month: number; volume: number }[];
export type GapItem = { keyword: string; volume: number; monthly: Monthly | null; competitors: { domain: string; position: number; url: string | null }[] };

// ---------- puro ----------

/** Une los resultados de cada competidor por keyword (mejor posición primero) y ordena por volumen. */
export function mergeGap(perCompetitor: { domain: string; items: any[] }[]): GapItem[] {
  const by = new Map<string, GapItem>();
  for (const c of perCompetitor)
    for (const i of c.items ?? []) {
      const kw = String(i?.keyword_data?.keyword ?? "").trim();
      if (!kw) continue;
      const info = i.keyword_data.keyword_info ?? {};
      const e: GapItem = by.get(kw) ?? {
        keyword: kw,
        volume: Number(info.search_volume ?? 0),
        monthly: Array.isArray(info.monthly_searches) ? info.monthly_searches.filter((m: any) => m?.search_volume != null).map((m: any) => ({ year: m.year, month: m.month, volume: Number(m.search_volume) })) : null,
        competitors: [],
      };
      const el = i.first_domain_serp_element ?? {};
      e.competitors.push({ domain: c.domain, position: Number(el.rank_absolute ?? el.rank_group ?? 0), url: el.url ?? null });
      by.set(kw, e);
    }
  for (const e of by.values()) e.competitors.sort((a, b) => a.position - b.position);
  return [...by.values()].sort((a, b) => b.volume - a.volume || b.competitors.length - a.competitors.length);
}

/**
 * Meses pico: los que superan en 20 % o más el promedio del año. Devuelve números de mes (1–12) o vacío si la
 * demanda es pareja o faltan datos (menos de 6 meses).
 */
export function peakMonths(monthly: Monthly | null | undefined, ratio = 1.2): number[] {
  if (!monthly || monthly.length < 6) return [];
  const last12 = [...monthly].sort((a, b) => a.year - b.year || a.month - b.month).slice(-12);
  const avg = last12.reduce((s, m) => s + m.volume, 0) / last12.length;
  if (!avg) return [];
  return [...new Set(last12.filter((m) => m.volume >= avg * ratio).map((m) => m.month))].sort((a, b) => a - b);
}
export const monthNames = (ms: number[]) => ms.map((m) => MONTHS[m - 1]).join(", ");

/** Temas con pico en los próximos `ahead` meses (contando desde `now`): hay que preparar el contenido ya. */
export function upcomingPeaks<T extends { monthly?: Monthly | null }>(items: T[], now: Date, ahead = 2) {
  const next = Array.from({ length: ahead }, (_, i) => ((now.getUTCMonth() + 1 + i) % 12) + 1);
  return items.map((x) => ({ x, peaks: peakMonths(x.monthly) })).filter((r) => r.peaks.some((m) => next.includes(m)));
}

/**
 * Solo keywords del tema del sitio (ver keyword-triage): todas sus palabras de tema aparecen en el vocabulario propio.
 * Competidores generalistas (multitiendas, marketplaces) rankean en miles de cosas que el negocio no vende.
 */
export function relevantGap<T extends { keyword: string }>(items: T[], vocab: Iterable<string>) {
  const own = siteVocabulary(vocab);
  const relevant: T[] = [], discarded: T[] = [];
  for (const i of items) {
    const words = topicWords(i.keyword);
    (words.length && words.every((w) => own.has(w)) ? relevant : discarded).push(i);
  }
  return { relevant, discarded };
}

// ---------- llamadas ----------

export async function runKeywordGap(projectId: string, opts: { force?: boolean } = {}) {
  if (!backlinksConfigured()) return { skipped: "no disponible en este servidor" };
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const recent = await db.keywordGap.findFirst({ where: { projectId, createdAt: { gte: new Date(Date.now() - GAP_REFRESH_DAYS * DAY) } } });
  if (recent && !opts.force) return { reused: true };
  const own = bareDomain(p.domain);
  const serps = await competitorsOverview(projectId, hostOf(`https://${p.domain}`));
  const competitors = pickCompetitors((((p.settings ?? {}) as any).competitors ?? []) as string[], serps?.top ?? [], own);
  if (!competitors.length) return { skipped: "sin competidores (agrégalos en Resultados o monitorea keywords en Rankings)" };
  await assertBudget({ dataforseo: GAP_USD_ESTIMATE * competitors.length }, "Keyword gap");
  const errors: string[] = [];
  const per: { domain: string; items: any[] }[] = [];
  for (const c of competitors) {
    try {
      const res = await fetchT(`${dfsBase()}/v3/dataforseo_labs/google/domain_intersection/live`, {
        method: "POST",
        headers: { Authorization: dfsAuth(), "Content-Type": "application/json" },
        body: JSON.stringify([{ target1: c, target2: own, intersections: false, location_code: p.locationCode, language_code: p.language, item_types: ["organic"], filters: ["first_domain_serp_element.rank_absolute", "<=", 20], order_by: ["keyword_data.keyword_info.search_volume,desc"], limit: 200 }]),
        timeoutMs: 120000,
      });
      const json: any = await res.json().catch(() => null);
      const acct = dfsAccountError(res.status, json);
      if (acct) throw acct;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await logCost("dataforseo", "labs/domain_intersection", 1, { projectId, ref: c }, typeof json?.cost === "number" ? json.cost : null);
      const t = json?.tasks?.[0];
      if (t?.status_code && t.status_code >= 40000) throw new Error(t.status_message);
      per.push({ domain: c, items: t?.result?.[0]?.items ?? [] });
    } catch (e) {
      if ((e as any)?.status === "no_balance" || (e as any)?.status === "auth_error") throw e;
      errors.push(`${c}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
    }
  }
  const items = mergeGap(per);
  await db.keywordGap.create({ data: { projectId, competitors, items: items.slice(0, 500) as any, errors } });
  return { competitors, keywords: items.length, errors };
}

export async function gapOverview(projectId: string) {
  const g = await db.keywordGap.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } });
  const own = await db.keyword.findMany({ where: { projectId, excluded: false }, select: { term: true, volume: true, monthly: true }, orderBy: { volume: "desc" }, take: 300 });
  const now = new Date();
  const ownWithMonthly = own.filter((k) => Array.isArray(k.monthly)).map((k) => ({ keyword: k.term, volume: k.volume ?? 0, monthly: k.monthly as Monthly }));
  // vocabulario propio: titles/H1 del último crawl público, consultas de Search Console y keywords investigadas
  const crawl = await db.crawl.findFirst({ where: { projectId, private: false, status: { in: ["completed", "partial"] } }, orderBy: { startedAt: "desc" }, select: { id: true } });
  const [pages, queries] = await Promise.all([
    crawl ? db.page.findMany({ where: { crawlId: crawl.id, status: 200 }, select: { title: true, h1: true }, take: 3000 }) : [],
    db.gscRow.groupBy({ by: ["query"], where: { projectId }, _sum: { impressions: true }, orderBy: { _sum: { impressions: "desc" } }, take: 500 }),
  ]);
  const vocab = [...pages.map((p) => `${p.title ?? ""} ${p.h1.join(" ")}`), ...queries.map((q) => q.query)];
  const all = (g?.items as GapItem[] | undefined) ?? [];
  // sin vocabulario propio no se puede juzgar: se muestra todo con la advertencia de siempre
  const { relevant, discarded } = vocab.length ? relevantGap(all, vocab) : { relevant: all, discarded: [] as GapItem[] };
  const items = relevant;
  return {
    gap: g
      ? {
          at: g.createdAt.toISOString(),
          competitors: g.competitors,
          total: items.length,
          items: items.slice(0, 50).map((i) => ({ ...i, peaks: peakMonths(i.monthly) })),
          errors: g.errors,
          discarded: discarded.length,
          discardedExamples: discarded.slice(0, 5).map((i) => i.keyword),
        }
      : null,
    // estacionalidad: keywords propias y del gap que suben en los próximos 2 meses
    upcoming: upcomingPeaks([...ownWithMonthly, ...items], now)
      .sort((a, b) => (b.x as any).volume - (a.x as any).volume)
      .slice(0, 15)
      .map((r) => ({ keyword: (r.x as any).keyword as string, volume: (r.x as any).volume as number, peaks: monthNames(r.peaks) })),
  };
}
