/**
 * Ejecuta un actor de Apify una vez y guarda la salida REAL como fixture de tests.
 *   APIFY_TOKEN=... npm run apify-fixture -- [--actor s-r~google-keywords] [--seed "zapatillas trail"] [--limit 15]
 *   APIFY_TOKEN=... npm run apify-fixture -- --actor steadyfetch~keyword-search-volume-scraper --keywords "zapatillas trail,botas trekking"
 * Escribe src/lib/testing/fixtures/apify-google-keywords.json o apify-steadyfetch.json (los tests prefieren el real).
 */
import { writeFileSync } from "node:fs";
import { ApifyClient, isListActor } from "../src/lib/volume/apify";
import { env } from "../src/lib/env";

const arg = (n: string, d: string) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);

(async () => {
  if (!env.apifyToken) throw new Error("falta APIFY_TOKEN");
  const actor = arg("actor", env.apifyActor).replace("/", "~");
  const list = isListActor(actor);
  const input = list
    ? { keywords: arg("keywords", "zapatillas trail,botas trekking").split(",").map((s) => s.trim()), country: "CL", language: "es", mode: "metrics-only" }
    : { keyword: arg("seed", "zapatillas trail"), country: "cl", language: "es", limit: Number(arg("limit", "15")), min_volume: 0 };
  const { items, run } = await new ApifyClient(env.apifyToken, actor).runAsync(input, list ? 0.5 : undefined);
  const file = `src/lib/testing/fixtures/${list ? "apify-steadyfetch" : "apify-google-keywords"}.json`;
  writeFileSync(file, JSON.stringify({ _meta: { origin: "real", actor, runId: run.id, usageTotalUsd: run.usageTotalUsd ?? null, input, fetchedAt: new Date().toISOString() }, items }, null, 2));
  console.log(`${items.length} items, costo $${run.usageTotalUsd ?? "?"} → ${file}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
