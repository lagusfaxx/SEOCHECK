/** Caché de volumen + prioridad GSC + Apify (servidor simulado). Requiere DATABASE_URL. */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const hasDb = Boolean(process.env.DATABASE_URL);
const hits: { path: string; body: any }[] = [];
let srv: http.Server;
const ids: string[] = [];

before(async () => {
  if (!hasDb) return;
  srv = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const u = new URL(req.url!, "http://x");
      const body = raw ? JSON.parse(raw) : null;
      hits.push({ path: u.pathname, body });
      const json = (o: unknown) => res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify(o));
      if (u.pathname.endsWith("/run-sync-get-dataset-items")) {
        // el actor expande el seed: devuelve el seed y 2 variantes; "botas raras" no aparece
        return json([
          { keyword: body.keyword, country: "cl", language: "es", volume: 1000, cpc_usd: 0.5, competition: 0.4, intent: "commercial" },
          { keyword: `${body.keyword} mujer`, volume: 0, competition: "LOW", intent: "transactional" },
          { keyword: `${body.keyword} baratas`, volume: 90 },
        ]);
      }
      if (u.pathname.endsWith("/runs")) return json({ data: { items: [{ id: `r${hits.length}`, startedAt: new Date(Date.now() - 500).toISOString() }] } });
      if (u.pathname.startsWith("/v2/actor-runs/")) return json({ data: { id: "r", status: "SUCCEEDED", usageTotalUsd: 0.009, defaultDatasetId: "d" } });
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  Object.assign(process.env, { VOLUME_PROVIDERS: "apify,csv", APIFY_MODE: "seed", APIFY_MONTHLY_USD: "-1", APIFY_TOKEN: "tok", APIFY_BASE_URL: `http://127.0.0.1:${(srv.address() as any).port}` });
  const { db } = await import("./db");
  const ws = await db.workspace.create({ data: { name: "test-vol" } });
  for (const n of ["a", "b"]) ids.push((await db.project.create({ data: { workspaceId: ws.id, name: n, domain: `${n}.cl`, country: "zz", language: "es" } })).id);
  await db.volumeCache.deleteMany({ where: { country: "zz" } });
});

after(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  await db.volumeCache.deleteMany({ where: { country: "zz" } });
  await db.providerUsage.deleteMany({ where: { projectId: { in: ids } } });
  await db.project.deleteMany({ where: { id: { in: ids } } });
  await db.workspace.deleteMany({ where: { name: "test-vol" } });
  srv.close();
  await db.$disconnect();
});

const ctx = (projectId: string) => ({ country: "zz", language: "es", locationCode: 2152, projectId, seeds: ["botas trekking"] });
const kws = ["botas trekking", "botas trekking mujer", "botas trekking baratas", "botas raras"];

test("Apify por seed: mapea, deja null lo no devuelto y registra costo", { skip: !hasDb }, async () => {
  const { resolveVolumes } = await import("./volume/broker");
  const { db } = await import("./db");
  const r = await resolveVolumes(kws, ctx(ids[0]));
  const runs = hits.filter((h) => h.path.endsWith("/run-sync-get-dataset-items"));
  assert.equal(runs.length, 1, "un run por seed");
  assert.deepEqual(runs[0].body, { keyword: "botas trekking", country: "zz", language: "es", limit: 500, min_volume: 0 });
  assert.equal(r.data.get("botas trekking")!.volume, 1000);
  assert.equal(r.data.get("botas trekking")!.source, "apify");
  assert.equal(r.data.get("botas trekking mujer")!.volume, 0, "0 real");
  assert.equal(r.data.has("botas raras"), false, "no devuelta → sin dato (null)");
  assert.equal(r.stats.missing, 1);
  const cost = await db.providerUsage.findFirst({ where: { projectId: ids[0], provider: "apify" } });
  assert.equal(cost?.costUsd, 0.009);
});

test("caché: la segunda consulta (otro proyecto, mismo país+idioma) no llama al proveedor", { skip: !hasDb }, async () => {
  const { resolveVolumes } = await import("./volume/broker");
  const before = hits.length;
  const r = await resolveVolumes(kws.slice(0, 3), ctx(ids[1]));
  assert.equal(hits.length, before, "sin requests nuevas");
  assert.equal(r.stats.cache, 3);
  assert.equal(r.data.get("botas trekking baratas")!.volume, 90);
});

test("caché vencida (> 30 días) se vuelve a consultar", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  const { resolveVolumes } = await import("./volume/broker");
  await db.volumeCache.updateMany({ where: { country: "zz", keyword: "botas trekking" }, data: { fetchedAt: new Date(Date.now() - 31 * 864e5) } });
  const before = hits.length;
  await resolveVolumes(["botas trekking"], ctx(ids[1]));
  assert.ok(hits.length > before);
});

test("prioridad: impresiones GSC > proveedor", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  const { resolveVolumes } = await import("./volume/broker");
  await db.gscRow.create({ data: { projectId: ids[0], date: new Date(Date.now() - 5 * 864e5), query: "botas trekking mujer", page: "https://a.cl/", clicks: 3, impressions: 420, ctr: 0.007, position: 8 } });
  const r = await resolveVolumes(["botas trekking mujer"], ctx(ids[0]));
  assert.equal(r.data.get("botas trekking mujer")!.source, "gsc");
  assert.equal(r.data.get("botas trekking mujer")!.volume, 420);
  // en el otro proyecto (sin GSC) sigue el dato del proveedor
  const r2 = await resolveVolumes(["botas trekking mujer"], ctx(ids[1]));
  assert.equal(r2.data.get("botas trekking mujer")!.source, "apify");
});

test("sin APIFY_TOKEN el proveedor queda no disponible y no rompe", { skip: !hasDb }, async () => {
  const { env } = await import("./env");
  const { resolveVolumes, volumeChainStatus } = await import("./volume/broker");
  const saved = env.apifyToken;
  (env as any).apifyToken = "";
  try {
    assert.deepEqual(await volumeChainStatus(), [{ provider: "apify", available: false, reason: "falta APIFY_TOKEN" }, { provider: "csv", available: true, reason: null }]);
    const r = await resolveVolumes(["algo nuevo sin caché"], ctx(ids[1]));
    assert.equal(r.data.size, 0);
    assert.deepEqual(r.stats.skipped, ["apify: falta APIFY_TOKEN"]);
    assert.equal(r.stats.provider, "csv");
  } finally {
    (env as any).apifyToken = saved;
  }
});
