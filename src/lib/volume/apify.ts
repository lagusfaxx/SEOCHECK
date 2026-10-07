import { env } from "../env";
import { logCost } from "../costs";
import { jobLog } from "../jobctx";
import { fetchT, normTerm, sleep } from "../util";
import type { VolumeCtx, VolumeData, VolumeProvider } from "./types";
import { cleanKeyword } from "../providers/sanitize";

/**
 * Actor s-r~google-keywords (configurable con APIFY_ACTOR_ID). Input real del actor:
 *   { keyword: string (seed, requerido), country, language, limit (1–500), max_suggestions, min_volume (def. 10), concurrency }
 * Salida (dataset): { keyword, country, language, volume, cpc, cpc_usd, sd, pd, competition, intent }.
 * El actor expande UN seed en variantes con volumen; no acepta una lista de keywords.
 */

type Any = Record<string, any>;
export type ApifyRun = { id: string; status: string; defaultDatasetId: string; usageTotalUsd?: number; startedAt?: string; finishedAt?: string; statusMessage?: string };

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]);

/** Número desde number | "1,300" | "1.3K" | "$0.45" | "0,45". */
export function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[$€£\s]/g, "");
  const mult = /k$/i.test(s) ? 1e3 : /m$/i.test(s) ? 1e6 : 1;
  s = s.replace(/[km]$/i, "");
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^\d+,\d+$/.test(s)) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n * mult : null;
}

/** competition a 0–1: número 0–1, índice 0–100 o etiqueta LOW/MEDIUM/HIGH. */
export function competition01(v: unknown): number | null {
  if (typeof v === "string" && !/^[\d.,\s%]+$/.test(v)) {
    const t = v.toLowerCase();
    if (/low|baja/.test(t)) return 0.25;
    if (/medium|media/.test(t)) return 0.5;
    if (/high|alta/.test(t)) return 0.85;
    return null;
  }
  const n = num(typeof v === "string" ? v.replace("%", "") : v);
  if (n == null) return null;
  return n > 1 ? Math.min(1, n / 100) : n;
}

const INTENTS: Record<string, string> = {
  informational: "informational", info: "informational", i: "informational",
  commercial: "commercial", c: "commercial", investigation: "commercial",
  transactional: "transactional", t: "transactional",
  navigational: "navigational", n: "navigational",
};
export function mapIntent(v: unknown): string | null {
  const first = Array.isArray(v) ? v[0] : typeof v === "string" ? v.split(/[,/|]/)[0] : null;
  if (!first) return null;
  return INTENTS[String(first).trim().toLowerCase()] ?? null;
}

/** Item del dataset → nuestro modelo. Ítems con error o sin keyword se descartan. */
export function mapApifyItem(it: Any): VolumeData | null {
  if (!it || typeof it !== "object" || (it.errors && !it.keyword) || it.error) return null;
  const kw = typeof it.keyword === "string" ? normTerm(it.keyword) : "";
  if (!kw) return null;
  const vol = num(it.volume);
  return {
    keyword: kw,
    volume: vol == null ? null : Math.round(vol),
    cpc: num(it.cpc_usd) ?? num(it.cpc),
    competition: competition01(it.competition),
    intent: mapIntent(it.intent),
  };
}

export class ApifyClient {
  constructor(
    private token = env.apifyToken,
    private actor = env.apifyActor,
    private base = env.apifyBase,
    private poll = { intervalMs: 5000, timeoutMs: 15 * 60_000 }
  ) {}

  private headers() {
    return { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" };
  }

  /** Batches chicos: run-sync-get-dataset-items (máx. 300 s; 408 si se pasa). */
  async runSync(input: Any): Promise<{ items: Any[]; run: ApifyRun | null }> {
    const started = Date.now();
    const res = await fetchT(`${this.base}/v2/acts/${this.actor}/run-sync-get-dataset-items?timeout=300&format=json&clean=1`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(input),
      timeoutMs: 320_000,
    });
    if (res.status === 408) throw new Error("Apify: el run superó 300 s (run-sync)");
    if (!res.ok) throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const items = (await res.json()) as Any[];
    // run-sync no devuelve el run: se busca por ventana de tiempo para leer usageTotalUsd (best effort)
    const run = await this.findRunBetween(started - 2000, Date.now() + 2000).catch(() => null);
    return { items, run };
  }

  private async findRunBetween(from: number, to: number): Promise<ApifyRun | null> {
    const res = await fetchT(`${this.base}/v2/acts/${this.actor}/runs?desc=1&limit=10`, { headers: this.headers() });
    if (!res.ok) return null;
    const items: ApifyRun[] = ((await res.json()) as Any).data?.items ?? [];
    const hits = items.filter((r) => r.startedAt && Date.parse(r.startedAt) >= from && Date.parse(r.startedAt) <= to);
    if (hits.length !== 1) return null;
    // el listado no siempre trae usage; se lee el run completo
    return this.getRun(hits[0].id);
  }

  async start(input: Any): Promise<ApifyRun> {
    const res = await fetchT(`${this.base}/v2/acts/${this.actor}/runs?timeout=300`, { method: "POST", headers: this.headers(), body: JSON.stringify(input) });
    if (!res.ok) throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return ((await res.json()) as Any).data;
  }

  async getRun(id: string): Promise<ApifyRun> {
    const res = await fetchT(`${this.base}/v2/actor-runs/${id}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Apify run ${id}: ${res.status}`);
    return ((await res.json()) as Any).data;
  }

  async abort(id: string) {
    await fetchT(`${this.base}/v2/actor-runs/${id}/abort`, { method: "POST", headers: this.headers() }).catch(() => {});
  }

  /** Polling hasta estado terminal. Lanza si FAILED/TIMED-OUT/ABORTED o si se acaba nuestro plazo (y aborta el run). */
  async waitFor(id: string): Promise<ApifyRun> {
    const deadline = Date.now() + this.poll.timeoutMs;
    for (;;) {
      const run = await this.getRun(id);
      if (TERMINAL.has(run.status)) {
        if (run.status !== "SUCCEEDED") throw Object.assign(new Error(`Apify run ${id} terminó ${run.status}${run.statusMessage ? `: ${run.statusMessage}` : ""}`), { run });
        return run;
      }
      if (Date.now() > deadline) {
        await this.abort(id);
        throw Object.assign(new Error(`Apify run ${id} sin terminar tras ${Math.round(this.poll.timeoutMs / 1000)} s (abortado)`), { run });
      }
      await sleep(this.poll.intervalMs);
    }
  }

  async datasetItems(datasetId: string): Promise<Any[]> {
    const res = await fetchT(`${this.base}/v2/datasets/${datasetId}/items?clean=1&format=json`, { headers: this.headers(), timeoutMs: 120_000 });
    if (!res.ok) throw new Error(`Apify dataset ${datasetId}: ${res.status}`);
    return (await res.json()) as Any[];
  }

  /** Batches grandes: POST /runs + polling + dataset. */
  async runAsync(input: Any): Promise<{ items: Any[]; run: ApifyRun }> {
    const started = await this.start(input);
    const run = await this.waitFor(started.id);
    return { items: await this.datasetItems(run.defaultDatasetId), run };
  }
}

export class ApifyFetcher implements VolumeProvider {
  readonly source = "apify" as const;
  constructor(private client = new ApifyClient(), private opts = { syncMax: 200, limit: 500 }) {}

  unavailable() {
    return env.apifyToken ? null : "falta APIFY_TOKEN";
  }

  async fetch(keywords: string[], ctx: VolumeCtx): Promise<VolumeData[]> {
    // Un run por seed; sin seeds, cada keyword es su propio seed.
    // Seeds y cruce por keyword limpia (sin ¿?¡! ni símbolos), mapeada de vuelta a los términos originales
    const seeds = [...new Set((ctx.seeds?.length ? ctx.seeds : keywords).map(cleanKeyword).filter(Boolean))];
    const wanted = new Map<string, string[]>();
    for (const k of keywords) {
      const c = cleanKeyword(k);
      if (c) wanted.set(c, [...(wanted.get(c) ?? []), normTerm(k)]);
    }
    const sync = keywords.length <= this.opts.syncMax;
    const found = new Map<string, VolumeData>();
    let total = 0;
    for (const seed of seeds) {
      const input = { keyword: seed, country: ctx.country.toLowerCase(), language: ctx.language.toLowerCase(), limit: this.opts.limit, min_volume: 0 };
      try {
        const { items, run } = sync ? await this.client.runSync(input) : await this.client.runAsync(input);
        const usd = run?.usageTotalUsd ?? null;
        if (usd != null) total += usd;
        await jobLog("info", `Apify ${sync ? "run-sync" : "run"} seed="${seed}": ${items.length} items, costo ${usd != null ? `$${usd.toFixed(4)}` : "no disponible (run-sync sin run identificable)"}`, { runId: run?.id ?? null, usageTotalUsd: usd });
        await logCost("apify", sync ? "run-sync" : "run", 1, { projectId: ctx.projectId, ref: seed }, usd);
        for (const it of items) {
          const m = mapApifyItem(it);
          for (const original of (m && wanted.get(cleanKeyword(m.keyword))) || []) found.set(original, { ...m!, keyword: original });
        }
      } catch (e: any) {
        await jobLog("error", `Apify seed="${seed}" falló: ${e.message}`, { usageTotalUsd: e.run?.usageTotalUsd ?? null });
        if (e.run?.usageTotalUsd != null) await logCost("apify", "run", 1, { projectId: ctx.projectId, ref: seed }, e.run.usageTotalUsd);
      }
    }
    await jobLog("info", `Apify: ${found.size}/${keywords.length} keywords con volumen; costo total $${total.toFixed(4)}`);
    return [...found.values()];
  }
}
