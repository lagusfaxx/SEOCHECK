/**
 * Ejecuta el actor de Apify una vez y guarda la salida REAL como fixture de tests.
 *   APIFY_TOKEN=... npm run apify-fixture -- [--seed "zapatillas trail"] [--limit 15]
 * Escribe src/lib/testing/fixtures/apify-google-keywords.json (el test lo prefiere sobre el de schema).
 */
import { writeFileSync } from "node:fs";
import { ApifyClient } from "../src/lib/volume/apify";
import { env } from "../src/lib/env";

const arg = (n: string, d: string) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);

(async () => {
  if (!env.apifyToken) throw new Error("falta APIFY_TOKEN");
  const input = { keyword: arg("seed", "zapatillas trail"), country: "cl", language: "es", limit: Number(arg("limit", "15")), min_volume: 0 };
  const { items, run } = await new ApifyClient().runAsync(input);
  const out = { _meta: { origin: "real", actor: env.apifyActor, runId: run.id, usageTotalUsd: run.usageTotalUsd ?? null, input, fetchedAt: new Date().toISOString() }, items };
  writeFileSync("src/lib/testing/fixtures/apify-google-keywords.json", JSON.stringify(out, null, 2));
  console.log(`${items.length} items, costo $${run.usageTotalUsd ?? "?"} → src/lib/testing/fixtures/apify-google-keywords.json`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
