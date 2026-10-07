/** Cadena de volumen: DataForSEO sin saldo → Apify (exact) → CSV. Requiere DATABASE_URL. */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const hasDb = Boolean(process.env.DATABASE_URL);
const hits: { host: string; path: string; body: any }[] = [];
let dfsReply: (body: any) => { status: number; json: unknown } = () => ({ status: 200, json: {} });
const servers: http.Server[] = [];
let projectId = "";

function serve(host: string, handler: (path: string, body: any) => { status: number; json: unknown }) {
  return new Promise<string>((ok) => {
    const s = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const u = new URL(req.url!, "http://x");
        const body = raw ? JSON.parse(raw) : null;
        hits.push({ host, path: u.pathname, body });
        const r = handler(u.pathname, body);
        res.writeHead(r.status, { "content-type": "application/json" }).end(JSON.stringify(r.json));
      });
    });
    servers.push(s);
    s.listen(0, "127.0.0.1", () => ok(`http://127.0.0.1:${(s.address() as any).port}`));
  });
}

before(async () => {
  if (!hasDb) return;
  const dfs = await serve("dfs", (_p, b) => dfsReply(b));
  const apify = await serve("apify", (p, b) => {
    if (p.endsWith("/run-sync-get-dataset-items")) return { status: 201, json: [{ keyword: b.keyword, volume: 70 }] };
    if (p.endsWith("/runs")) return { status: 200, json: { data: { items: [] } } };
    return { status: 404, json: {} };
  });
  Object.assign(process.env, {
    VOLUME_PROVIDERS: "dataforseo,apify,csv", DATAFORSEO_LOGIN: "l", DATAFORSEO_PASSWORD: "p", DATAFORSEO_BASE_URL: dfs,
    APIFY_TOKEN: "t", APIFY_BASE_URL: apify, APIFY_MODE: "exact",
  });
  const { db } = await import("./db");
  await db.providerState.deleteMany({});
  const ws = await db.workspace.create({ data: { name: "test-chain" } });
  projectId = (await db.project.create({ data: { workspaceId: ws.id, name: "c", domain: "c.cl", country: "xx", language: "es" } })).id;
  await db.volumeCache.deleteMany({ where: { country: "xx" } });
});

after(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  await db.volumeCache.deleteMany({ where: { country: "xx" } });
  await db.providerState.deleteMany({});
  await db.providerUsage.deleteMany({ where: { projectId } });
  await db.project.deleteMany({ where: { id: projectId } });
  await db.workspace.deleteMany({ where: { name: "test-chain" } });
  servers.forEach((s) => s.close());
  await db.$disconnect();
});

const ctx = () => ({ country: "xx", language: "es", locationCode: 2152, projectId });

test("DataForSEO responde sin saldo (40210) → Apify, y queda marcado", { skip: !hasDb }, async () => {
  dfsReply = () => ({ status: 200, json: { status_code: 20000, tasks: [{ status_code: 40210, status_message: "Insufficient Funds." }] } });
  const { resolveVolumes, volumeChainStatus } = await import("./volume/broker");
  const r = await resolveVolumes(["botas", "carpa"], ctx());
  assert.equal(r.stats.provider, "apify");
  assert.deepEqual(r.stats.skipped, ["dataforseo: sin saldo"]);
  assert.equal(r.data.get("botas")!.source, "apify");
  assert.equal(r.data.get("botas")!.volume, 70);
  const st = await volumeChainStatus();
  assert.equal(st[0].provider, "dataforseo");
  assert.equal(st[0].available, false);
  assert.match(st[0].reason!, /sin saldo desde/);
});

test("mientras está marcado no se vuelve a llamar a DataForSEO", { skip: !hasDb }, async () => {
  const { resolveVolumes } = await import("./volume/broker");
  const before = hits.filter((h) => h.host === "dfs").length;
  const r = await resolveVolumes(["mochila"], ctx());
  assert.equal(hits.filter((h) => h.host === "dfs").length, before);
  assert.equal(r.stats.provider, "apify");
  assert.match(r.stats.skipped[0], /^dataforseo: sin saldo desde/);
});

test("vencido el plazo se reintenta; con saldo vuelve a ser el principal (HTTP 402 también cuenta)", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  const { resolveVolumes } = await import("./volume/broker");
  await db.providerState.update({ where: { provider: "dataforseo" }, data: { until: new Date(Date.now() - 1000) } });
  dfsReply = (b) => ({ status: 200, json: { status_code: 20000, tasks: [{ status_code: 20000, result: b[0].keywords.map((k: string) => ({ keyword: k, search_volume: 900 })) }] } });
  const r = await resolveVolumes(["saco dormir"], ctx());
  assert.equal(r.stats.provider, "dataforseo");
  assert.equal(r.data.get("saco dormir")!.volume, 900);
  assert.equal((await db.providerState.findUnique({ where: { provider: "dataforseo" } }))!.status, "ok");
  dfsReply = () => ({ status: 402, json: { status_code: 40200, status_message: "Payment Required." } });
  const r2 = await resolveVolumes(["linterna frontal"], ctx());
  assert.equal(r2.stats.provider, "apify");
});

test("sin proveedores disponibles queda el CSV (solo lo importado)", { skip: !hasDb }, async () => {
  const { env } = await import("./env");
  const { resolveVolumes } = await import("./volume/broker");
  const saved = env.apifyToken;
  (env as any).apifyToken = "";
  try {
    const r = await resolveVolumes(["algo sin dato"], ctx());
    assert.equal(r.stats.provider, "csv");
    assert.equal(r.data.size, 0);
    assert.deepEqual(r.stats.skipped.map((s: string) => s.split(":")[0]), ["dataforseo", "apify"]);
  } finally {
    (env as any).apifyToken = saved;
  }
});
