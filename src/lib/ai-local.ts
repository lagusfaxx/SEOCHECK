/**
 * Visibilidad en IA y SEO local con la clave de Serpent del servidor (el cliente no configura claves).
 *
 * - IA: para las keywords monitoreadas (hasta 10), si ChatGPT, Claude, Gemini y Perplexity citan el sitio al
 *   responder, en qué posición y a quién citan en su lugar.
 * - Local: posición en Google Maps para las keywords locales del proyecto (configuradas en Resultados: ciudad o
 *   comuna, nombre del negocio y keywords), con rating y los 3 primeros.
 *
 * Una revisión por semana como máximo, con presupuesto mensual de Serpent (SERPENT_MONTHLY_USD).
 */
import { db } from "./db";
import { env } from "./env";
import { logCost } from "./costs";
import { assertBudget } from "./budget";
import { serpentGet } from "./providers/serpent";
import { hostOf } from "./util";

const DAY = 864e5;
export const AI_ENGINES = ["chatgpt", "claude", "gemini", "perplexity"] as const;
/** Default tier de Serpent: $20 / 1.000 llamadas por motor. */
export const AI_USD_PER_ENGINE = Number(process.env.SERPENT_AI_USD_PER_ENGINE ?? 0.02);
/** Maps quick search (sin precio publicado para planes pagos: cota conservadora). */
export const MAPS_USD_PER_CALL = Number(process.env.SERPENT_MAPS_USD_PER_CALL ?? 0.015);
export const MAX_AI_KEYWORDS = 10;
export const MAX_LOCAL_KEYWORDS = 5;

export type LocalSettings = { location?: string; businessName?: string; keywords?: string[] };
export const localOf = (settings: unknown): LocalSettings => ((settings as any)?.local ?? {}) as LocalSettings;

const bare = (d: string) => d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
const simple = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ---------- parsers (puros) ----------

export type AiResult = { engine: string; found: boolean; position: number | null; cited: string[] };

/**
 * La respuesta combinada trae un bloque por motor con target_found/target_position/citations. La forma exacta del
 * contenedor no está documentada (objeto por motor o lista con `engine`), así que se busca cada bloque que tenga
 * `target_found` y se toma el motor de su campo o de la clave que lo contiene.
 */
export function parseAiRank(json: unknown): AiResult[] {
  const out: AiResult[] = [];
  const walk = (node: any, key: string | null) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, key));
    if ("target_found" in node) {
      const engine = String(node.engine ?? node.llm ?? node.model ?? key ?? "ia").toLowerCase();
      const cited = ((node.citations ?? []) as any[]).map((c) => bare(String(c.domain ?? c.url ?? ""))).filter(Boolean);
      out.push({ engine, found: Boolean(node.target_found), position: node.target_position ?? null, cited: [...new Set(cited)].slice(0, 10) });
      return;
    }
    for (const [k, v] of Object.entries(node)) walk(v, k);
  };
  walk(json, null);
  return out;
}

export type Place = { rank: number; name: string; website: string | null; rating: number | null };
export const parsePlaces = (json: any): Place[] =>
  ((json?.places ?? []) as any[]).map((p, i) => ({ rank: Number(p.rank ?? i + 1), name: String(p.name ?? ""), website: p.website ?? null, rating: p.rating != null ? Number(p.rating) : null }));

/** El negocio propio en la lista: por dominio del sitio, o por nombre si se configuró. */
export function findOwnPlace(places: Place[], domain: string, businessName?: string): Place | null {
  const d = bare(domain);
  const byWeb = places.find((p) => p.website && (bare(p.website) === d || bare(p.website).endsWith(`.${d}`)));
  if (byWeb) return byWeb;
  if (!businessName) return null;
  const n = simple(businessName);
  return places.find((p) => simple(p.name) === n || simple(p.name).includes(n)) ?? null;
}

// ---------- ejecución ----------

export async function runAiVisibility(projectId: string, opts: { force?: boolean } = {}) {
  if (!env.serpentKey) return { skipped: "no disponible en esta instalación" };
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const recent = await db.aiCheck.findFirst({ where: { projectId, checkedAt: { gte: new Date(Date.now() - 7 * DAY) } } });
  if (recent && !opts.force) return { reused: true };
  const tracked = await db.trackedKeyword.findMany({ where: { projectId, active: true }, orderBy: { createdAt: "asc" }, take: MAX_AI_KEYWORDS, select: { keyword: true } });
  if (!tracked.length) return { skipped: "sin keywords monitoreadas en Rankings" };
  await assertBudget({ serpent: tracked.length * AI_ENGINES.length * AI_USD_PER_ENGINE }, `Visibilidad en IA (${tracked.length} keywords)`);
  const domain = bare(hostOf(`https://${p.domain}`));
  let n = 0;
  const errors: string[] = [];
  for (const t of tracked) {
    try {
      const json = await serpentGet("/api/ai/rank", { keyword: t.keyword, domain, engines: AI_ENGINES.join(","), country: p.country, language: p.language });
      await logCost("serpent", "ai/rank", AI_ENGINES.length, { projectId, ref: t.keyword }, AI_ENGINES.length * AI_USD_PER_ENGINE);
      const rows = parseAiRank(json);
      if (rows.length) await db.aiCheck.createMany({ data: rows.map((r) => ({ projectId, keyword: t.keyword, engine: r.engine, found: r.found, position: r.position, cited: r.cited })) });
      n += rows.length;
    } catch (e) {
      errors.push(`${t.keyword}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
      if ((e as any)?.transient === false && /saldo|balance|key|402|401/i.test(String((e as any)?.message))) break;
    }
  }
  return { checks: n, keywords: tracked.length, errors };
}

export async function runLocal(projectId: string, opts: { force?: boolean } = {}) {
  if (!env.serpentKey) return { skipped: "no disponible en esta instalación" };
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const cfg = localOf(p.settings);
  const keywords = (cfg.keywords ?? []).slice(0, MAX_LOCAL_KEYWORDS);
  if (!cfg.location || !keywords.length) return { skipped: "sin keywords locales (Resultados → SEO local)" };
  const recent = await db.localRank.findFirst({ where: { projectId, checkedAt: { gte: new Date(Date.now() - 7 * DAY) } } });
  if (recent && !opts.force) return { reused: true };
  await assertBudget({ serpent: keywords.length * MAPS_USD_PER_CALL }, `SEO local (${keywords.length} keywords)`);
  const errors: string[] = [];
  for (const keyword of keywords) {
    try {
      const json = await serpentGet("/api/maps/search/quick", { q: keyword, location: cfg.location, country: p.country, language: p.language });
      await logCost("serpent", "maps/quick", 1, { projectId, ref: keyword }, MAPS_USD_PER_CALL);
      const places = parsePlaces(json);
      const own = findOwnPlace(places, p.domain, cfg.businessName);
      await db.localRank.create({
        data: { projectId, keyword, location: cfg.location, position: own?.rank ?? null, rating: own?.rating ?? null, name: own?.name ?? null, top: places.slice(0, 3).map((x) => ({ name: x.name, rating: x.rating, website: x.website })) as any },
      });
    } catch (e) {
      errors.push(`${keyword}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
    }
  }
  return { keywords: keywords.length, errors };
}

/** Última revisión de IA y local, con la anterior para comparar. */
export async function aiLocalOverview(projectId: string) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { settings: true } });
  const lastAi = await db.aiCheck.findFirst({ where: { projectId }, orderBy: { checkedAt: "desc" }, select: { checkedAt: true } });
  let ai = null;
  if (lastAi) {
    const rows = await db.aiCheck.findMany({ where: { projectId, checkedAt: { gte: new Date(lastAi.checkedAt.getTime() - DAY) } } });
    const byEngine = new Map<string, { total: number; found: number }>();
    const competitors = new Map<string, number>();
    for (const r of rows) {
      const e = byEngine.get(r.engine) ?? { total: 0, found: 0 };
      e.total++;
      if (r.found) e.found++;
      byEngine.set(r.engine, e);
      for (const d of r.cited) competitors.set(d, (competitors.get(d) ?? 0) + 1);
    }
    const keywords = [...new Set(rows.map((r) => r.keyword))].map((k) => ({ keyword: k, engines: rows.filter((r) => r.keyword === k).map((r) => ({ engine: r.engine, found: r.found, position: r.position })) }));
    ai = {
      at: lastAi.checkedAt.toISOString(),
      engines: [...byEngine.entries()].map(([engine, v]) => ({ engine, ...v, share: v.total ? v.found / v.total : 0 })),
      keywords,
      topCited: [...competitors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([domain, count]) => ({ domain, count })),
    };
  }
  const lastLocal = await db.localRank.findFirst({ where: { projectId }, orderBy: { checkedAt: "desc" }, select: { checkedAt: true } });
  let local = null;
  if (lastLocal) {
    const rows = await db.localRank.findMany({ where: { projectId, checkedAt: { gte: new Date(lastLocal.checkedAt.getTime() - DAY) } }, orderBy: { keyword: "asc" } });
    const prev = await db.localRank.findMany({ where: { projectId, checkedAt: { lt: new Date(lastLocal.checkedAt.getTime() - DAY) } }, orderBy: { checkedAt: "desc" }, take: 50 });
    local = {
      at: lastLocal.checkedAt.toISOString(),
      rows: rows.map((r) => ({ keyword: r.keyword, location: r.location, position: r.position, previous: prev.find((x) => x.keyword === r.keyword)?.position ?? null, rating: r.rating, top: r.top as { name: string; rating: number | null }[] })),
    };
  }
  return { configured: Boolean(env.serpentKey), local: localOf(p.settings), ai, localRanks: local };
}
