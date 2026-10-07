/**
 * Integración con Postgres (requiere DATABASE_URL; si no está, se omite).
 * Serpent se simula con un servidor local.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startMockSerpent } from "./testing/mockSerpent";

const hasDb = Boolean(process.env.DATABASE_URL);
let mock: Awaited<ReturnType<typeof startMockSerpent>>;
let projectId = "";

before(async () => {
  if (!hasDb) return;
  mock = await startMockSerpent({ organicFor: (q) => Array.from({ length: 100 }, (_, i) => ({ url: i === 41 ? `https://www.mi-sitio.cl/${encodeURIComponent(q)}` : `https://comp${i}.cl/` })) });
  process.env.SERPENT_API_KEY = "test-key";
  process.env.SERPENT_BASE_URL = mock.url;
  const { db } = await import("./db");
  const ws = await db.workspace.create({ data: { name: "test" } });
  projectId = (await db.project.create({ data: { workspaceId: ws.id, name: "t", domain: "mi-sitio.cl" } })).id;
});

after(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  await db.project.delete({ where: { id: projectId } }).catch(() => {});
  await db.workspace.deleteMany({ where: { name: "test", projects: { none: {} } } });
  await db.apiCall.deleteMany({ where: { projectId } });
  await mock.close();
  await db.$disconnect();
});

test("rank tracking usa Quick num=100 y registra 1 unidad por keyword", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  const { checkRank } = await import("./rank/rank");
  const kws = ["zapatillas trail", "zapatillas running", "botas trekking"];
  for (const keyword of kws) {
    const t = await db.trackedKeyword.create({ data: { projectId, keyword } });
    const c = await checkRank(t.id);
    assert.equal(c.position, 42);
    assert.equal(c.url, `https://www.mi-sitio.cl/${encodeURIComponent(keyword)}`);
  }
  const calls = await db.apiCall.findMany({ where: { projectId } });
  assert.equal(calls.length, kws.length);
  assert.ok(calls.every((c) => c.provider === "serpent" && c.endpoint === "quick" && c.units === 1));
  assert.ok(mock.hits.every((h) => h.path === "/api/search/quick" && h.params.num === "100"));
  assert.equal(mock.hits.length, kws.length);
});

test("research/content usan Deep de 1 página con PAA y related, y caché no reutiliza snapshots de Quick", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  const { getSerp } = await import("./serp");
  const before = mock.hits.length;
  const s = await getSerp(projectId, "zapatillas trail", { country: "cl", language: "es" });
  const hit = mock.hits.at(-1)!;
  assert.equal(mock.hits.length, before + 1, "debe llamar a Deep aunque exista snapshot Quick");
  assert.equal(hit.path, "/api/search");
  assert.equal(hit.params.pages, "1");
  assert.equal(hit.params.num, undefined);
  assert.deepEqual(s.paa, ["¿qué es zapatillas trail?", "¿cómo elegir zapatillas trail?"]);
  assert.deepEqual(s.related, ["zapatillas trail barato", "zapatillas trail chile"]);
  await getSerp(projectId, "zapatillas trail", { country: "cl", language: "es" });
  assert.equal(mock.hits.length, before + 1, "segunda llamada sale de caché");
  const deep = await db.apiCall.findMany({ where: { projectId, endpoint: "deep" } });
  assert.equal(deep.length, 1);
  assert.equal(deep[0].units, 1);
});
