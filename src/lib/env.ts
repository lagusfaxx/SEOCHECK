export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  serpentKey: process.env.SERPENT_API_KEY ?? "",
  serpentBase: process.env.SERPENT_BASE_URL ?? "https://apiserpent.com",
  dfsLogin: process.env.DATAFORSEO_LOGIN ?? "",
  dfsPassword: process.env.DATAFORSEO_PASSWORD ?? "",
  /** sandbox (gratis, datos ficticios) | live */
  dfsEnv: (process.env.DATAFORSEO_ENV === "live" ? "live" : "sandbox") as "live" | "sandbox",
  dfsBaseOverride: process.env.DATAFORSEO_BASE_URL ?? "",
  /** Segundos que el research espera la standard queue de DataForSEO antes de seguir (lo pendiente se completa después) */
  dfsQueueWait: Number(process.env.DATAFORSEO_QUEUE_WAIT_SECONDS ?? 300),
  /** dataforseo | apify | csv */
  volumeProvider: (process.env.VOLUME_PROVIDER ?? "dataforseo") as "dataforseo" | "apify" | "csv",
  apifyToken: process.env.APIFY_TOKEN ?? "",
  apifyActor: (process.env.APIFY_ACTOR_ID || "s-r~google-keywords").replace("/", "~"),
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
