export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  serpentKey: process.env.SERPENT_API_KEY ?? "",
  serpentBase: process.env.SERPENT_BASE_URL ?? "https://apiserpent.com",
  dfsLogin: process.env.DATAFORSEO_LOGIN ?? "",
  dfsPassword: process.env.DATAFORSEO_PASSWORD ?? "",
  /** live (default) | sandbox (gratis, datos ficticios) */
  dfsEnv: (process.env.DATAFORSEO_ENV === "sandbox" ? "sandbox" : "live") as "live" | "sandbox",
  /** live (default): endpoint Live | queue: standard queue multi-proyecto */
  dfsMode: (process.env.DATAFORSEO_MODE === "queue" ? "queue" : "live") as "live" | "queue",
  dfsBaseOverride: process.env.DATAFORSEO_BASE_URL ?? "",
  /** Segundos que el research espera la standard queue de DataForSEO antes de seguir (lo pendiente se completa después) */
  dfsQueueWait: Number(process.env.DATAFORSEO_QUEUE_WAIT_SECONDS ?? 300),
  /** Cadena de proveedores de volumen en orden (GSC siempre va primero cuando hay impresiones) */
  volumeProviders: (process.env.VOLUME_PROVIDERS ?? process.env.VOLUME_PROVIDER ?? "dataforseo,apify,csv")
    .split(",").map((s) => s.trim()).filter((s): s is "dataforseo" | "apify" | "csv" => ["dataforseo", "apify", "csv"].includes(s)),
  apifyToken: process.env.APIFY_TOKEN ?? "",
  apifyActor: (process.env.APIFY_ACTOR_ID || "s-r~google-keywords").replace("/", "~"),
  /** s-r~google-keywords: exact (un run por keyword, limit=1) | seed (un run por seed, variantes) */
  apifyMode: (process.env.APIFY_MODE === "seed" ? "seed" : "exact") as "exact" | "seed",
  apifyConcurrency: Math.max(1, Number(process.env.APIFY_CONCURRENCY ?? 3)),
  apifyBase: process.env.APIFY_BASE_URL ?? "https://api.apify.com",
  embeddingsUrl: process.env.EMBEDDINGS_URL ?? "",
  openaiKey: process.env.OPENAI_API_KEY ?? "",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  llmModel: process.env.LLM_MODEL || "claude-sonnet-5-5",
  psiKey: process.env.PAGESPEED_API_KEY ?? "",
  gscCredentials: process.env.GSC_SERVICE_ACCOUNT_JSON ?? "",
  browserWs: process.env.BROWSER_WS_ENDPOINT ?? "",
  indexNowKey: process.env.INDEXNOW_KEY ?? "",
  userAgent: process.env.CRAWLER_UA ?? "Mozilla/5.0 (compatible; SEOCheckBot/1.0)",
  tz: process.env.TZ ?? "America/Santiago",
};

export function has(...keys: (keyof typeof env)[]) {
  return keys.every((k) => Boolean(env[k]));
}
