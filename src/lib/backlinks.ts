/**
 * Backlinks con la cuenta de DataForSEO del servidor (DATAFORSEO_LOGIN/PASSWORD): el cliente no configura nada.
 *
 * Por proyecto guarda una foto con:
 * - resumen del sitio y de hasta 3 competidores (los de Ajustes o, si no hay, los que más aparecen en sus SERPs);
 * - dominios de referencia con más autoridad, nuevos (últimos 30 días) y perdidos;
 * - backlinks que apuntan a páginas con error (se recuperan con un 301);
 * - dominios que enlazan a los competidores y no al sitio (prospección).
 *
 * Una foto por semana como máximo: con presupuesto mensual (DATAFORSEO_MONTHLY_USD) y costo real registrado.
 */
import { db } from "./db";
import { env } from "./env";
import { logCost } from "./costs";
import { fetchT, hostOf } from "./util";
import { dfsAuth, dfsBase, dfsAccountError } from "./volume/dataforseo";
import { assertBudget } from "./budget";
import { competitorsOverview } from "./marketing";

const DAY = 864e5;
/** Cota superior por foto: ~10 llamadas de ~$0,02 más filas. */
export const BACKLINKS_USD_ESTIMATE = 0.4;
export const REFRESH_DAYS = 7;

/** Plataformas que aparecen en todas las SERPs y no son competidores reales. */
const NOT_COMPETITORS = /(^|\.)(google\.[a-z.]+|youtube\.com|wikipedia\.org|facebook\.com|instagram\.com|tiktok\.com|linkedin\.com|twitter\.com|x\.com|pinterest\.[a-z.]+|reddit\.com|quora\.com|amazon\.[a-z.]+)$/i;

export const backlinksConfigured = () => Boolean(env.dfsLogin && env.dfsPassword);

/** Dominio limpio como lo pide DataForSEO: sin protocolo ni www. */
export const bareDomain = (d: string) => d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();

// ---------- respuesta → datos (puro) ----------

export type Summary = { target: string; backlinks: number; referringDomains: number; rank: number; brokenBacklinks: number; nofollowDomains: number };
export type RefDomain = { domain: string; rank: number; backlinks: number; firstSeen: string | null; lostDate: string | null };
export type Broken = { from: string; to: string; anchor: string | null; status: number | null; dofollow: boolean; rank: number };
export type GapDomain = { domain: string; rank: number; linksTo: number };

export function parseSummary(r: any, target: string): Summary {
  return {
    target,
    backlinks: Number(r?.backlinks ?? 0),
    referringDomains: Number(r?.referring_domains ?? 0),
    rank: Number(r?.rank ?? 0),
    brokenBacklinks: Number(r?.broken_backlinks ?? 0),
    nofollowDomains: Number(r?.referring_domains_nofollow ?? 0),
  };
}
export const parseReferring = (items: any[]): RefDomain[] =>
  (items ?? []).map((i) => ({ domain: String(i.domain), rank: Number(i.rank ?? 0), backlinks: Number(i.backlinks ?? 0), firstSeen: i.first_seen ?? null, lostDate: i.lost_date ?? null }));
export const parseBroken = (items: any[]): Broken[] =>
  (items ?? []).map((i) => ({ from: String(i.url_from), to: String(i.url_to), anchor: i.anchor ?? null, status: i.url_to_status_code ?? null, dofollow: Boolean(i.dofollow), rank: Number(i.domain_from_rank ?? i.rank ?? 0) }));
/** domain_intersection: cada ítem trae el dominio de referencia por competidor ("1", "2"…). */
export const parseGap = (items: any[]): GapDomain[] =>
  (items ?? [])
    .map((i) => {
      const per = Object.values(i?.domain_intersection ?? {}) as any[];
      const first = per.find((x) => x?.target) ?? {};
      return { domain: String(first.target ?? ""), rank: Math.max(0, ...per.map((x) => Number(x?.rank ?? 0))), linksTo: Number(i?.summary?.intersections_count ?? per.length) };
    })
    .filter((g) => g.domain);

/** Nuevos: vistos por primera vez en los últimos `days` días respecto de `now`. */
export function newDomains(ref: RefDomain[], now: Date, days = 30) {
  return ref.filter((r) => r.firstSeen && now.getTime() - new Date(r.firstSeen.replace(" +00:00", "Z").replace(" ", "T")).getTime() <= days * DAY);
}

/** Competidores: los configurados; si no hay, los dominios con más visibilidad en las SERPs guardadas. */
export function pickCompetitors(configured: string[], fromSerps: { domain: string; own: boolean }[], own: string, max = 3) {
  const clean = (d: string) => bareDomain(d);
  const list = configured.length ? configured.map(clean) : fromSerps.filter((r) => !r.own).map((r) => clean(r.domain));
  return [...new Set(list)].filter((d) => d && d !== own && !d.endsWith(`.${own}`) && !NOT_COMPETITORS.test(d)).slice(0, max);
}

// ---------- llamadas ----------

async function call(path: string, task: Record<string, unknown>, projectId: string) {
  const res = await fetchT(`${dfsBase()}/v3/backlinks/${path}/live`, { method: "POST", headers: { Authorization: dfsAuth(), "Content-Type": "application/json" }, body: JSON.stringify([task]), timeoutMs: 120000 });
  const json: any = await res.json().catch(() => null);
  const acct = dfsAccountError(res.status, json);
  if (acct) throw acct;
  if (!res.ok) throw new Error(`DataForSEO backlinks/${path}: HTTP ${res.status}`);
  const cost = typeof json?.cost === "number" ? json.cost : null;
  await logCost("dataforseo", `backlinks/${path}`, 1, { projectId, ref: String(task.target ?? Object.values((task.targets as object) ?? {}).join(",")) }, cost);
  const t = json?.tasks?.[0];
  if (t?.status_code && t.status_code >= 40000) throw new Error(`DataForSEO backlinks/${path}: ${t.status_message}`);
  return { result: t?.result?.[0] ?? null, cost: cost ?? 0 };
}

/** Saca una foto de backlinks. Sin `force`, reutiliza la de los últimos 7 días. */
export async function runBacklinks(projectId: string, opts: { force?: boolean } = {}) {
  if (!backlinksConfigured()) return { skipped: "falta DATAFORSEO_LOGIN/PASSWORD en el servidor" };
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const recent = await db.backlinkSnapshot.findFirst({ where: { projectId, createdAt: { gte: new Date(Date.now() - REFRESH_DAYS * DAY) } }, orderBy: { createdAt: "desc" } });
  if (recent && !opts.force) return { reused: recent.id };
  await assertBudget({ dataforseo: BACKLINKS_USD_ESTIMATE }, "Backlinks");

  const own = bareDomain(p.domain);
  const configured = (((p.settings ?? {}) as any).competitors ?? []) as string[];
  const serps = await competitorsOverview(projectId, hostOf(`https://${p.domain}`));
  const competitors = pickCompetitors(configured, serps?.top ?? [], own);
  const errors: string[] = [];
  let cost = 0;
  // cada parte es independiente: si una falla, el resto se guarda igual
  const part = async <T,>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if ((e as any)?.status === "no_balance" || (e as any)?.status === "auth_error") throw e;
      errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
      return fallback;
    }
  };
  const run = async (path: string, task: Record<string, unknown>) => {
    const r = await call(path, task, projectId);
    cost += r.cost;
    return r.result;
  };

  const summary = await part("resumen", async () => parseSummary(await run("summary", { target: own, include_subdomains: true }), own), parseSummary(null, own));
  const competitorSummaries = await Promise.all(competitors.map((c) => part(`resumen ${c}`, async () => parseSummary(await run("summary", { target: c, include_subdomains: true }), c), null)));
  const referring = await part("dominios de referencia", async () => parseReferring((await run("referring_domains", { target: own, limit: 300, order_by: ["rank,desc"] }))?.items), [] as RefDomain[]);
  const lost = await part("dominios perdidos", async () => parseReferring((await run("referring_domains", { target: own, backlinks_status_type: "lost", limit: 50, order_by: ["rank,desc"] }))?.items), [] as RefDomain[]);
  const broken = await part("links rotos", async () => parseBroken((await run("backlinks", { target: own, filters: ["is_broken", "=", true], order_by: ["domain_from_rank,desc"], limit: 100 }))?.items), [] as Broken[]);
  const gap = competitors.length
    ? await part("brecha con competidores", async () => parseGap((await run("domain_intersection", { targets: Object.fromEntries(competitors.map((c, i) => [String(i + 1), c])), exclude_targets: [own], order_by: ["1.rank,desc"], limit: 100 }))?.items), [] as GapDomain[])
    : [];

  const snap = await db.backlinkSnapshot.create({
    data: {
      projectId, target: own, competitors, summary: summary as any, competitorSummaries: competitorSummaries.filter(Boolean) as any,
      referring: referring as any, lost: lost as any, broken: broken as any, gap: gap as any, errors, costUsd: cost,
    },
  });
  return { snapshot: snap.id, competitors, errors, cost };
}

/** Lo último guardado, listo para mostrar: incluye nuevos (30 días) y la variación contra la foto anterior. */
export async function backlinksOverview(projectId: string) {
  const [last, prev] = await db.backlinkSnapshot.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 2 });
  if (!last) return { configured: backlinksConfigured(), snapshot: null };
  const summary = last.summary as unknown as Summary;
  const referring = last.referring as unknown as RefDomain[];
  return {
    configured: backlinksConfigured(),
    snapshot: {
      at: last.createdAt.toISOString(),
      target: last.target,
      competitors: last.competitors,
      summary,
      previous: prev ? (prev.summary as unknown as Summary) : null,
      competitorSummaries: last.competitorSummaries as unknown as Summary[],
      topReferring: referring.slice(0, 20),
      newDomains: newDomains(referring, last.createdAt).slice(0, 20),
      lost: (last.lost as unknown as RefDomain[]).slice(0, 20),
      broken: last.broken as unknown as Broken[],
      gap: (last.gap as unknown as GapDomain[]).slice(0, 50),
      errors: last.errors,
    },
  };
}
