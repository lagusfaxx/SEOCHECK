/**
 * Compara volúmenes de DataForSEO y Apify para una lista de keywords (máx. 100).
 *
 *   npm run compare-volume -- --file keywords.txt [--out compare-volume.csv] [--country cl --language es --location 2152] [--apify-mode exact|seed] [--apify-limit 20]
 *
 * DataForSEO usa el endpoint Live del entorno configurado (DATAFORSEO_ENV=sandbox|live; sandbox = datos ficticios).
 * Apify usa APIFY_ACTOR_ID: s-r~google-keywords en modo exact (un run por keyword, limit=1) por defecto
 * (--apify-mode seed para variantes), o steadyfetch~keyword-search-volume-scraper con la lista en un run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ApifyFetcher } from "../src/lib/volume/apify";
import { dfsLive } from "../src/lib/volume/dataforseo";
import { volKey } from "../src/lib/volume/broker";
import { env } from "../src/lib/env";
import { spearman, median } from "../src/lib/volume/stats";

function arg(name: string, def?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const file = arg("file");
  if (!file) throw new Error("uso: npm run compare-volume -- --file keywords.txt");
  const kws = [...new Set(readFileSync(file, "utf8").split(/\r?\n/).map((l) => volKey(l)).filter(Boolean))];
  if (kws.length > 100) throw new Error(`máximo 100 keywords (el archivo tiene ${kws.length})`);
  const ctx = { country: arg("country", "cl")!, language: arg("language", "es")!, locationCode: Number(arg("location", "2152")) };
  const out = arg("out", "compare-volume.csv")!;

  const dfs = new Map<string, number | null>();
  if (env.dfsLogin && env.dfsPassword) {
    console.log(`DataForSEO (${env.dfsEnv})…`);
    for (const r of await dfsLive(kws, ctx)) dfs.set(volKey(r.keyword), r.volume);
  } else console.log("DataForSEO: sin credenciales, se omite");

  const apify = new Map<string, number | null>();
  const apifyFetcher = new ApifyFetcher(undefined, { syncMax: 200, limit: Number(arg("apify-limit", "20")), mode: (arg("apify-mode", "exact") as "exact" | "seed") });
  if (!apifyFetcher.unavailable()) {
    console.log(`Apify (${env.apifyActor}), ${kws.length} runs…`);
    for (const r of await apifyFetcher.fetch(kws, ctx)) apify.set(volKey(r.keyword), r.volume);
  } else console.log(`Apify: ${apifyFetcher.unavailable()}, se omite`);

  const rows = kws.map((k) => {
    const a = dfs.get(k) ?? null, b = apify.get(k) ?? null;
    const diff = a != null && b != null && a > 0 ? ((b - a) / a) * 100 : null;
    return { k, a, b, diff };
  });
  const both = rows.filter((r) => r.a != null && r.b != null);
  const rho = spearman(both.map((r) => r.a!), both.map((r) => r.b!));
  const medDiff = median(rows.filter((r) => r.diff != null).map((r) => r.diff!));
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const csv = [
    "keyword,vol_dataforseo,vol_apify,diferencia_pct",
    ...rows.map((r) => [esc(r.k), r.a ?? "", r.b ?? "", r.diff != null ? r.diff.toFixed(1) : ""].join(",")),
    "",
    "# resumen",
    `# keywords,${kws.length}`,
    `# devueltas_dataforseo,${[...dfs.values()].filter((v) => v != null).length}`,
    `# devueltas_apify,${[...apify.values()].filter((v) => v != null).length}`,
    `# en_ambos,${both.length}`,
    `# spearman,${rho != null ? rho.toFixed(3) : "n/a"}`,
    `# mediana_diferencia_pct,${medDiff != null ? medDiff.toFixed(1) : "n/a"}`,
    `# dataforseo_env,${env.dfsEnv}`,
  ].join("\n");
  writeFileSync(out, csv);
  console.log(csv.split("\n").filter((l) => l.startsWith("#")).join("\n"));
  console.log(`\nCSV: ${out}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
