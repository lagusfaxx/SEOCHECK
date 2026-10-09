import { env } from "../env";
import { fetchT } from "../util";
import { dfsBase } from "../volume/dataforseo";
import { httpFail, netFail, ProviderError, type FailKind } from "./errors";

/**
 * Estado de las APIs externas usando sólo endpoints de cuenta/estado que no cobran:
 *   Serpent    GET /api/status            (créditos y llamadas gratis restantes)
 *   DataForSEO GET /v3/appendix/user_data (saldo)
 *   Apify      GET /v2/users/me/limits    (uso del mes vs. tope)
 *   OpenAI     GET /v1/models
 *   Anthropic  GET /v1/models
 *   Embeddings GET /health (text-embeddings-inference)
 * Nunca se lanza una búsqueda ni una generación para "probar".
 */
export type HealthStatus = "ok" | FailKind;
export type ProviderHealth = {
  provider: string;
  label: string;
  /** para qué se usa en la app */
  role: string;
  status: HealthStatus;
  message: string;
  /** saldo legible (sólo si el proveedor lo informa) */
  balance?: string;
  latencyMs?: number;
  checkedAt: string;
};

type Any = Record<string, any>;
type Probe = { provider: string; label: string; role: string; configured: () => boolean; run: () => Promise<{ message?: string; balance?: string; status?: HealthStatus }> };

const TIMEOUT = 10_000;
const usd = (n: number) => `US$${n.toFixed(2)}`;

async function getJson(provider: string, url: string, headers: Record<string, string>): Promise<Any> {
  const res = await fetchT(url, { headers, timeoutMs: TIMEOUT }).catch((e) => {
    throw netFail(provider, e);
  });
  const text = await res.text();
  if (!res.ok) throw httpFail(provider, res.status, text);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ProviderError(provider, "down", `${provider} devolvió una respuesta inválida`);
  }
}

const PROBES: Probe[] = [
  {
    provider: "serpent",
    label: "Serpent",
    role: "SERP (research, briefs, rank tracking)",
    configured: () => Boolean(env.serpentKey),
    run: async () => {
      const j = await getJson("Serpent", `${env.serpentBase}/api/status`, { "X-API-Key": env.serpentKey });
      const d: Any = j.data ?? j;
      const credits = Number(d.credits ?? NaN);
      const free = Number(d.freeSearches?.remaining ?? 0);
      const per = Number(d.costPerSearch ?? NaN);
      const parts = [Number.isFinite(credits) ? usd(credits) : null, Number.isFinite(credits) && per > 0 ? `≈${Math.floor(credits / per)} búsquedas` : null, free > 0 ? `${free} gratis` : null].filter(Boolean);
      if (Number.isFinite(credits) && credits <= 0 && free <= 0) return { status: "no_balance", message: "Serpent: sin créditos", balance: parts.join(" · ") };
      return { balance: parts.join(" · ") || undefined };
    },
  },
  {
    provider: "dataforseo",
    label: "DataForSEO",
    role: "Volumen de búsqueda",
    configured: () => Boolean(env.dfsLogin && env.dfsPassword),
    run: async () => {
      const auth = `Basic ${Buffer.from(`${env.dfsLogin}:${env.dfsPassword}`).toString("base64")}`;
      const j = await getJson("DataForSEO", `${dfsBase()}/v3/appendix/user_data`, { Authorization: auth });
      const code = Number(j.status_code ?? j.tasks?.[0]?.status_code ?? 20000);
      const msg = j.tasks?.[0]?.status_message ?? j.status_message ?? "";
      if (code === 40100 || code === 40101) return { status: "auth", message: `DataForSEO: credenciales inválidas (${msg})` };
      if (code === 40200 || code === 40210) return { status: "no_balance", message: `DataForSEO: sin saldo (${msg})` };
      if (code >= 50000) return { status: "down", message: `DataForSEO está con problemas (${msg || code})` };
      if (code !== 20000) return { status: "bad_request", message: `DataForSEO: ${msg || code}` };
      const balance = Number(j.tasks?.[0]?.result?.[0]?.money?.balance ?? NaN);
      if (Number.isFinite(balance) && balance <= 0) return { status: "no_balance", message: "DataForSEO: sin saldo", balance: usd(balance) };
      return { balance: Number.isFinite(balance) ? usd(balance) : undefined, message: env.dfsEnv === "sandbox" ? "sandbox (datos ficticios)" : undefined };
    },
  },
  {
    provider: "apify",
    label: "Apify",
    role: "Volumen de búsqueda (respaldo)",
    configured: () => Boolean(env.apifyToken),
    run: async () => {
      const j = await getJson("Apify", `${env.apifyBase}/v2/users/me/limits`, { Authorization: `Bearer ${env.apifyToken}` });
      const max = Number(j.data?.limits?.maxMonthlyUsageUsd ?? NaN);
      const used = Number(j.data?.current?.monthlyUsageUsd ?? NaN);
      if (!Number.isFinite(max) || !Number.isFinite(used)) return {};
      const left = max - used;
      const balance = `${usd(Math.max(0, left))} de ${usd(max)} este mes`;
      return left <= 0 ? { status: "no_balance", message: "Apify: se alcanzó el tope de uso mensual", balance } : { balance };
    },
  },
  {
    provider: "openai",
    label: "OpenAI",
    role: env.llmProvider === "openai" ? "LLM (intent, briefs) y embeddings" : "Embeddings",
    configured: () => Boolean(env.openaiKey),
    run: async () => {
      const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
      await getJson("OpenAI", `${base}/models`, { Authorization: `Bearer ${env.openaiKey}` });
      // OpenAI no expone el saldo por API: sin crédito se ve como 429 insufficient_quota al generar
      return {};
    },
  },
  {
    provider: "anthropic",
    label: "Anthropic",
    role: "LLM (intent, briefs)",
    configured: () => Boolean(env.anthropicKey),
    run: async () => {
      await getJson("Anthropic", "https://api.anthropic.com/v1/models?limit=1", { "x-api-key": env.anthropicKey, "anthropic-version": "2023-06-01" });
      return {};
    },
  },
  {
    provider: "embeddings",
    label: "Embeddings local",
    role: "Embeddings (clustering)",
    configured: () => Boolean(env.embeddingsUrl),
    run: async () => {
      const res = await fetchT(`${env.embeddingsUrl.replace(/\/$/, "")}/health`, { timeoutMs: TIMEOUT }).catch((e) => {
        throw netFail("Embeddings", e);
      });
      if (!res.ok) throw httpFail("Embeddings", res.status, await res.text().catch(() => ""));
      return {};
    },
  },
];

const OK_MSG: Record<string, string> = { ok: "Operativo" };

async function probe(p: Probe): Promise<ProviderHealth> {
  const base = { provider: p.provider, label: p.label, role: p.role, checkedAt: new Date().toISOString() };
  if (!p.configured()) return { ...base, status: "not_configured", message: "Sin credenciales configuradas" };
  const t0 = Date.now();
  try {
    const r = await p.run();
    const status = r.status ?? "ok";
    return { ...base, status, message: r.message ?? OK_MSG[status] ?? status, balance: r.balance, latencyMs: Date.now() - t0 };
  } catch (e) {
    const err = e instanceof ProviderError ? e : netFail(p.label, e);
    return { ...base, status: err.kind, message: err.message, latencyMs: Date.now() - t0 };
  }
}

let cache: { at: number; data: ProviderHealth[] } | null = null;
let inflight: Promise<ProviderHealth[]> | null = null;
const TTL_MS = Number(process.env.PROVIDER_HEALTH_TTL_SECONDS ?? 60) * 1000;

/** Chequea todas las APIs (en paralelo). Cacheado TTL_MS en el proceso; `fresh` fuerza un chequeo nuevo. */
export async function providerHealth(opts: { fresh?: boolean; only?: string[] } = {}): Promise<ProviderHealth[]> {
  const pick = (rows: ProviderHealth[]) => (opts.only ? rows.filter((r) => opts.only!.includes(r.provider)) : rows);
  if (!opts.fresh && cache && Date.now() - cache.at < TTL_MS) return pick(cache.data);
  inflight ??= Promise.all(PROBES.map(probe))
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return pick(await inflight);
}

/**
 * Antes de un trabajo que depende de un proveedor (y gasta cupo/saldo): si está caído o sin saldo, se
 * corta ahí con un mensaje claro en vez de fallar a mitad de camino. "not_configured" no bloquea
 * (cada flujo ya decide qué hace sin el proveedor).
 */
export async function assertProviderUp(provider: string) {
  const [h] = await providerHealth({ only: [provider] });
  if (!h || h.status === "ok" || h.status === "not_configured") return;
  throw new ProviderError(h.label, h.status, `${h.message}. Inténtalo más tarde; no se gastó cupo.`);
}
