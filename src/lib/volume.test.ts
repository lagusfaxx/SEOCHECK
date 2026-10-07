/** Apify (mapeo, polling) y CSV de Keyword Planner. Sin base de datos. */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { ApifyClient, mapApifyItem } from "./volume/apify";
import { parseKeywordPlannerCsv, parseVolumeRange } from "./volume/csv";
import { spearman } from "./volume/stats";

const REAL = "src/lib/testing/fixtures/apify-google-keywords.json";
const SCHEMA = "src/lib/testing/fixtures/apify-google-keywords.schema-sample.json";

test("Apify: mapeo de la salida del actor al modelo", (t) => {
  const real = existsSync(REAL);
  const fx = JSON.parse(readFileSync(real ? REAL : SCHEMA, "utf8"));
  t.diagnostic(`fixture: ${fx._meta.origin}${real ? "" : " (sin salida real: correr `npm run apify-fixture` con APIFY_TOKEN)"}`);
  const mapped = fx.items.map(mapApifyItem);
  if (real) {
    // Con salida real: toda fila con keyword mapea, volume numérico o null, nunca NaN
    for (const [i, m] of mapped.entries()) {
      if (!fx.items[i].keyword) continue;
      assert.ok(m, `item ${i} mapea`);
      assert.ok(m.volume === null || Number.isInteger(m.volume));
      assert.ok(m.competition === null || (m.competition >= 0 && m.competition <= 1));
    }
    return;
  }
  assert.deepEqual(mapped[0], { keyword: "zapatillas trail", volume: 2900, cpc: 0.41, competition: 0.92, intent: "transactional" });
  assert.equal(mapped[1].intent, "commercial"); // array → primero
  assert.deepEqual(mapped[2], { keyword: "zapatillas trail hombre", volume: 1300, cpc: 0.39, competition: 0.85, intent: "commercial" });
  assert.equal(mapped[3].volume, 0); // 0 real (min_volume=0), no null
  assert.equal(mapped[3].competition, 0.12); // índice 0–100 → 0–1
  assert.equal(mapped[3].intent, "informational");
  assert.equal(mapped[4].volume, null); // sin volumen → null, no 0
  assert.equal(mapped[5], null); // ítem de error se descarta
});

/** Servidor Apify falso; `runStates` define la secuencia de estados que devuelve el polling. */
async function mockApify(runStates: { status: string; usageTotalUsd?: number }[]) {
  const hits: { method: string; path: string; auth?: string }[] = [];
  let poll = 0;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url!, "http://x");
    hits.push({ method: req.method!, path: u.pathname + u.search, auth: req.headers.authorization });
    const json = (o: unknown, code = 200) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(o));
    if (req.method === "POST" && u.pathname.endsWith("/runs")) return json({ data: { id: "run1", status: "READY", defaultDatasetId: "ds1" } }, 201);
    if (u.pathname === "/v2/actor-runs/run1") {
      const st = runStates[Math.min(poll++, runStates.length - 1)];
      return json({ data: { id: "run1", defaultDatasetId: "ds1", ...st } });
    }
    if (u.pathname === "/v2/actor-runs/run1/abort") return json({ data: { id: "run1", status: "ABORTING" } });
    if (u.pathname === "/v2/datasets/ds1/items") return json([{ keyword: "a", volume: 10 }]);
    json({ error: "not found" }, 404);
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  return { base, hits, close: () => new Promise((r) => srv.close(r)) };
}

test("Apify: polling hasta SUCCEEDED, token solo en header", async () => {
  const m = await mockApify([{ status: "RUNNING" }, { status: "RUNNING" }, { status: "SUCCEEDED", usageTotalUsd: 0.0123 }]);
  const c = new ApifyClient("secret-token", "s-r~google-keywords", m.base, { intervalMs: 5, timeoutMs: 2000 });
  const r = await c.runAsync({ keyword: "a" });
  await m.close();
  assert.equal(r.run.usageTotalUsd, 0.0123);
  assert.deepEqual(r.items, [{ keyword: "a", volume: 10 }]);
  assert.ok(m.hits.every((h) => h.auth === "Bearer secret-token"));
  assert.ok(m.hits.every((h) => !h.path.includes("secret-token")), "token nunca en la URL");
  assert.equal(m.hits[0].path, "/v2/acts/s-r~google-keywords/runs?timeout=300");
});

test("Apify: run FAILED rechaza y conserva el costo", async () => {
  const m = await mockApify([{ status: "RUNNING" }, { status: "FAILED", usageTotalUsd: 0.004 }]);
  const c = new ApifyClient("t", "s-r~google-keywords", m.base, { intervalMs: 5, timeoutMs: 2000 });
  await assert.rejects(c.runAsync({ keyword: "a" }), (e: any) => /terminó FAILED/.test(e.message) && e.run.usageTotalUsd === 0.004);
  await m.close();
  assert.ok(!m.hits.some((h) => h.path.includes("/datasets/")), "no se lee el dataset de un run fallido");
});

test("Apify: run TIMED-OUT de Apify rechaza", async () => {
  const m = await mockApify([{ status: "TIMED-OUT" }]);
  const c = new ApifyClient("t", "s-r~google-keywords", m.base, { intervalMs: 5, timeoutMs: 2000 });
  await assert.rejects(c.runAsync({ keyword: "a" }), /terminó TIMED-OUT/);
  await m.close();
});

test("Apify: nuestro timeout de polling aborta el run", async () => {
  const m = await mockApify([{ status: "RUNNING" }]);
  const c = new ApifyClient("t", "s-r~google-keywords", m.base, { intervalMs: 10, timeoutMs: 80 });
  await assert.rejects(c.runAsync({ keyword: "a" }), /sin terminar tras/);
  await m.close();
  assert.ok(m.hits.some((h) => h.method === "POST" && h.path === "/v2/actor-runs/run1/abort"));
});

/** UTF-16LE con BOM y tabs, como exporta Keyword Planner. */
function plannerCsv(lines: string[]) {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(lines.join("\r\n"), "utf16le")]);
}

test("CSV Keyword Planner (inglés): UTF-16, tab, rangos", () => {
  const buf = plannerCsv([
    "Keyword Stats 2026-10-07 at 10_15_44",
    "September 1, 2025 - August 31, 2026",
    "Keyword\tCurrency\tAvg. monthly searches\tThree month change\tYoY change\tCompetition\tCompetition (indexed value)\tTop of page bid (low range)\tTop of page bid (high range)",
    "zapatillas trail\tCLP\t1K – 10K\t0%\t0%\tHigh\t92\t180.5\t720.25",
    "zapatillas trail mujer\tCLP\t100 – 1K\t0%\t0%\tHigh\t95\t\t",
    "que es trail running\tCLP\t10 – 100\t0%\t0%\tLow\t8\t\t",
    "zapatillas trail mapuche\tCLP\t0 – 10\t\t\t\t\t\t",
    "zapatillas trail salomon\tCLP\t1,300\t\t\tMedium\t50\t200\t400",
  ]);
  const { rows, skipped } = parseKeywordPlannerCsv(buf);
  assert.equal(skipped, 0);
  assert.deepEqual(rows[0], { keyword: "zapatillas trail", volume: 3162, volumeMin: 1000, volumeMax: 10000, cpc: 450.38, competition: 0.92, intent: null });
  assert.deepEqual([rows[1].volumeMin, rows[1].volumeMax, rows[1].cpc], [100, 1000, null]);
  assert.deepEqual([rows[3].volumeMin, rows[3].volumeMax, rows[3].volume], [0, 10, 5]);
  assert.deepEqual([rows[4].volumeMin, rows[4].volumeMax, rows[4].volume, rows[4].competition], [1300, 1300, 1300, 0.5]);
});

test("CSV Keyword Planner (español) y rangos con K/M", () => {
  const buf = plannerCsv([
    "Estadísticas de palabras clave 2026-10-07",
    "Palabra clave\tMoneda\tPromedio de búsquedas mensuales\tCompetencia\tCompetencia (valor indexado)\tPuja por la parte superior de la página (intervalo bajo)\tPuja por la parte superior de la página (intervalo alto)",
    "Zapatillas Running\tCLP\t10K – 100K\tAlta\t88\t120,5\t400,75",
  ]);
  const { rows } = parseKeywordPlannerCsv(buf);
  assert.deepEqual(rows[0], { keyword: "zapatillas running", volume: 31623, volumeMin: 10000, volumeMax: 100000, cpc: 260.63, competition: 0.88, intent: null });
  assert.deepEqual(parseVolumeRange("1M – 10M"), [1e6, 1e7]);
  assert.deepEqual(parseVolumeRange("100 - 1K"), [100, 1000]);
  assert.equal(parseVolumeRange("–"), null);
  assert.throws(() => parseKeywordPlannerCsv("a,b,c\n1,2,3"), /encabezado/);
});

test("Spearman", () => {
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1);
  assert.equal(spearman([1, 2], [1, 2]), null);
});

test("ApifyFetcher: seeds limpios y cruce con preguntas/símbolos", async () => {
  const { ApifyFetcher } = await import("./volume/apify");
  const { env } = await import("./env");
  (env as any).apifyToken = "t";
  const seen: string[] = [];
  const fake = {
    runSync: async (input: any) => {
      seen.push(input.keyword);
      return { items: [{ keyword: "qué es trail running", volume: 140 }, { keyword: "Trail Running Chile", volume: 50 }], run: null };
    },
  } as any;
  const r = await new ApifyFetcher(fake, { syncMax: 200, limit: 10, mode: "seed", actor: "s-r~google-keywords" }).fetch(["¿Qué es trail running?", "trail running chile", "no existe"], { country: "cl", language: "es", locationCode: 2152, seeds: ["¿qué es trail running?"] });
  assert.deepEqual(seen, ["qué es trail running"]);
  assert.deepEqual(r.map((x) => [x.keyword, x.volume]).sort(), [["trail running chile", 50], ["¿qué es trail running?", 140]]);
});

test("steadyfetch: mapeo de la fila real del README, fila sin dato y fila resumen", async (t) => {
  const { mapSteadyfetchItem } = await import("./volume/apify");
  const real = existsSync("src/lib/testing/fixtures/apify-steadyfetch.json");
  const fx = JSON.parse(readFileSync(real ? "src/lib/testing/fixtures/apify-steadyfetch.json" : "src/lib/testing/fixtures/apify-steadyfetch.readme-sample.json", "utf8"));
  t.diagnostic(`fixture: ${fx._meta.origin}`);
  const mapped = fx.items.map(mapSteadyfetchItem);
  if (real) {
    for (const [i, m] of mapped.entries()) if (m) assert.ok(Number.isInteger(m.volume) && fx.items[i].keyword);
    assert.ok(mapped.some(Boolean));
    return;
  }
  assert.deepEqual(mapped[0], { keyword: "quartz countertop sealer", volume: 1600, cpc: 0.88, competition: 0.95, intent: null });
  assert.equal(mapped[1], null, "avgMonthlySearches null → sin dato (queda null)");
  assert.equal(mapped[2], null, "fila resumen se ignora");
});

test("Apify exact: un run por keyword con limit=1/max_suggestions=0 y concurrencia acotada", async () => {
  const { ApifyFetcher } = await import("./volume/apify");
  const { env } = await import("./env");
  (env as any).apifyToken = "t";
  let active = 0, peak = 0;
  const inputs: any[] = [];
  const fake = {
    runSync: async (input: any) => {
      inputs.push(input);
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      // el actor devuelve la keyword exacta; si devolviera otra variante, no se usa
      return { items: input.keyword === "botas raras" ? [{ keyword: "botas raras baratas", volume: 50 }] : [{ keyword: input.keyword, volume: 100 }], run: null };
    },
  } as any;
  const kws = ["botas trekking", "botas raras", "¿qué es trekking?", "mochila 30l", "carpa", "saco dormir"];
  const r = await new ApifyFetcher(fake, { mode: "exact", concurrency: 2, actor: "s-r~google-keywords" }).fetch(kws, { country: "CL", language: "es", locationCode: 2152 });
  assert.equal(inputs.length, kws.length, "un run por keyword");
  assert.ok(inputs.every((i) => i.limit === 1 && i.max_suggestions === 0 && i.min_volume === 0 && i.country === "cl"));
  assert.equal(peak, 2, "respeta APIFY_CONCURRENCY");
  assert.equal(r.find((x) => x.keyword === "botas raras"), undefined, "variante distinta no cuenta: queda null");
  assert.equal(r.find((x) => x.keyword === "¿qué es trekking?")?.volume, 100);
});

test("steadyfetch: la lista va en un run con maxTotalChargeUsd y sin _demo", async () => {
  const { ApifyFetcher } = await import("./volume/apify");
  const { env } = await import("./env");
  (env as any).apifyToken = "t";
  const calls: any[] = [];
  const fake = {
    runSync: async (input: any, maxUsd: number) => {
      calls.push({ input, maxUsd });
      return { items: [{ keyword: "Botas Trekking", avgMonthlySearches: 1300, cpcUsd: 0.3, competitionIndex: 40 }, { keyword: "botas raras", avgMonthlySearches: null, missReason: "no-data" }, { delivered: 1, stoppedBy: "completed" }], run: { id: "r", status: "SUCCEEDED", defaultDatasetId: "d", usageTotalUsd: 0.202 } };
    },
  } as any;
  const f = new ApifyFetcher(fake, { actor: "steadyfetch~keyword-search-volume-scraper" });
  const r = await f.fetch(["botas trekking", "botas raras"], { country: "cl", language: "es", locationCode: 2152 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].input, { keywords: ["botas trekking", "botas raras"], country: "CL", language: "es", mode: "metrics-only", maxItems: 2, maxRunSeconds: 900 });
  assert.ok(calls[0].maxUsd >= 0.25);
  assert.deepEqual(r, [{ keyword: "botas trekking", volume: 1300, cpc: 0.3, competition: 0.4, intent: null }]);
  assert.ok(Math.abs(f.estimateUsd(2) - (0.19 + 0.024)) < 1e-9);
});

test("DataForSEO: detección de sin saldo y credenciales", async () => {
  const { dfsAccountError } = await import("./volume/dataforseo");
  assert.equal(dfsAccountError(402, null)?.status, "no_balance");
  assert.equal(dfsAccountError(200, { status_code: 20000, tasks: [{ status_code: 40210, status_message: "Insufficient Funds." }] })?.status, "no_balance");
  assert.equal(dfsAccountError(200, { status_code: 40200 })?.status, "no_balance");
  assert.equal(dfsAccountError(401, null)?.status, "auth_error");
  assert.equal(dfsAccountError(200, { status_code: 20000, tasks: [{ status_code: 20000 }] }), null);
  assert.equal(dfsAccountError(200, { status_code: 20000, tasks: [{ status_code: 40501 }] }), null, "keyword inválida no es falta de saldo");
});
