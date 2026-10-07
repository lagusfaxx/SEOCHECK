/** DataForSEO standard queue multi-proyecto, Live con aislamiento y sandbox por defecto. Requiere DATABASE_URL. */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const hasDb = Boolean(process.env.DATABASE_URL);
const hits: { path: string; body: any; auth?: string }[] = [];
let getCalls = 0;
let srv: http.Server;
const ids: string[] = [];
const VOL: Record<string, number> = { "zapatos cuero": 1900, "zapatos cuero hombre": 720, "botines mujer": 2400 };

before(async () => {
  if (!hasDb) return;
  srv = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const u = new URL(req.url!, "http://x");
      const body = raw ? JSON.parse(raw) : null;
      hits.push({ path: u.pathname, body, auth: req.headers.authorization });
      const json = (o: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(o));
      const base = "/v3/keywords_data/google_ads/search_volume";
      if (u.pathname === `${base}/task_post/`.slice(0, -1) || u.pathname === `${base}/task_post`)
        return json({ tasks: [{ id: "task-1", status_code: 20100, status_message: "Task Created.", data: body[0] }] });
      if (u.pathname === `${base}/task_get/task-1`) {
        if (getCalls++ === 0) return json({ tasks: [{ id: "task-1", status_code: 40602, status_message: "Task In Queue." }] });
        const sent = hits.find((h) => h.path.endsWith("/task_post"))!.body[0].keywords as string[];
        return json({ tasks: [{ id: "task-1", status_code: 20000, result: sent.filter((k) => VOL[k]).map((k) => ({ keyword: k, search_volume: VOL[k], cpc: 0.3, competition_index: 50 })) }] });
      }
      if (u.pathname === `${base}/live`) {
        const kws = body[0].keywords as string[];
        if (kws.includes("casino online")) return json({ tasks: [{ status_code: 40501, status_message: "Invalid Field: 'keywords'." }] });
        return json({ tasks: [{ status_code: 20000, result: kws.map((k) => ({ keyword: k, search_volume: 100, cpc: null, competition_index: null })) }] });
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  Object.assign(process.env, { VOLUME_PROVIDER: "dataforseo", DATAFORSEO_LOGIN: "l", DATAFORSEO_PASSWORD: "p", DATAFORSEO_BASE_URL: `http://127.0.0.1:${(srv.address() as any).port}` });
  const { db } = await import("./db");
  const ws = await db.workspace.create({ data: { name: "test-dfs" } });
  for (const n of ["a", "b"]) ids.push((await db.project.create({ data: { workspaceId: ws.id, name: n, domain: `${n}.cl`, country: "yy", language: "es", locationCode: 2152 } })).id);
  await db.volumeCache.deleteMany({ where: { country: "yy" } });
  await db.volumeRequest.deleteMany({});
});

after(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  await db.volumeCache.deleteMany({ where: { country: "yy" } });
  await db.volumeRequest.deleteMany({ where: { country: "yy" } });
  await db.project.deleteMany({ where: { id: { in: ids } } });
  await db.workspace.deleteMany({ where: { name: "test-dfs" } });
  srv.close();
  await db.$disconnect();
});

test("sandbox por defecto", async () => {
  const saved = process.env.DATAFORSEO_BASE_URL;
  const { env } = await import("./env");
  const { dfsBase } = await import("./volume/dataforseo");
  const prev = env.dfsBaseOverride;
  (env as any).dfsBaseOverride = "";
  assert.equal(env.dfsEnv, "sandbox");
  assert.equal(dfsBase(), "https://sandbox.dataforseo.com");
  (env as any).dfsEnv = "live";
  assert.equal(dfsBase(), "https://api.dataforseo.com");
  (env as any).dfsEnv = "sandbox";
  (env as any).dfsBaseOverride = prev;
  process.env.DATAFORSEO_BASE_URL = saved;
});

test("standard queue: un task con keywords de dos proyectos, polling y backfill", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  const { enqueueDfs, flushDfsQueue, collectDfsQueue } = await import("./volume/dataforseo");
  const { writeCache, backfillVolumes } = await import("./volume/broker");
  const ctx = (projectId: string) => ({ country: "yy", language: "es", locationCode: 2152, projectId });
  // keywords ya guardadas en cada proyecto, sin volumen
  await db.keyword.createMany({ data: [
    { projectId: ids[0], term: "zapatos cuero", sources: ["seed"], relevance: 1 },
    { projectId: ids[0], term: "zapatos cuero hombre", sources: ["autocomplete"], relevance: 0.8 },
    { projectId: ids[1], term: "botines mujer", sources: ["seed"], relevance: 1 },
    { projectId: ids[1], term: "zapatos cuero", sources: ["related"], relevance: 0.6 },
  ] });
  await enqueueDfs(["zapatos cuero", "zapatos cuero hombre", "keyword sin datos"], ctx(ids[0]));
  await enqueueDfs(["botines mujer", "zapatos cuero"], ctx(ids[1])); // "zapatos cuero" ya está en cola: no se duplica
  assert.equal(await db.volumeRequest.count({ where: { country: "yy" } }), 4);

  assert.equal(await flushDfsQueue(), 1);
  const posts = hits.filter((h) => h.path.endsWith("/task_post"));
  assert.equal(posts.length, 1, "un solo task para ambos proyectos");
  assert.deepEqual([...posts[0].body[0].keywords].sort(), ["botines mujer", "keyword sin datos", "zapatos cuero", "zapatos cuero hombre"]);
  assert.equal(posts[0].body[0].location_code, 2152);
  assert.match(posts[0].auth ?? "", /^Basic /);

  const write = (rows: any, c: string, l: string) => writeCache(rows, c, l, "dataforseo");
  const first = await collectDfsQueue(write);
  assert.deepEqual([first.done, first.waiting], [0, 1], "Task In Queue → sigue esperando");
  const second = await collectDfsQueue(write);
  assert.equal(second.done, 1);
  let updated = 0;
  for (const t of second.touched) updated += await backfillVolumes(t.country, t.language, t.keywords);
  assert.equal(updated, 4, "las 4 keywords de ambos proyectos reciben volumen");
  const kb = await db.keyword.findFirstOrThrow({ where: { projectId: ids[1], term: "zapatos cuero" } });
  assert.equal(kb.volume, 1900);
  assert.equal(kb.volumeSource, "dataforseo");
  assert.ok(kb.volumeAt);
  assert.equal(await db.volumeCache.count({ where: { country: "yy", keyword: "keyword sin datos" } }), 0, "lo no devuelto no se inventa");
  assert.equal(await db.volumeRequest.count({ where: { country: "yy", status: "done" } }), 4);
});

test("Live (solo a pedido): aísla la keyword que hace fallar el task", { skip: !hasDb }, async () => {
  const { dfsLive } = await import("./volume/dataforseo");
  const before = hits.filter((h) => h.path.endsWith("/live")).length;
  const r = await dfsLive(["botas a", "botas b", "casino online", "botas c"], { country: "yy", language: "es", locationCode: 2152 });
  assert.deepEqual(r.map((x) => x.keyword).sort(), ["botas a", "botas b", "botas c"]);
  assert.ok(hits.filter((h) => h.path.endsWith("/live")).length - before > 1, "se dividió el batch");
});
