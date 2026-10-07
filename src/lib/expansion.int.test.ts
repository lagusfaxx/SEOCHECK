/** Punto 7: 2ª ronda de expansión con PAA/related, respetando el límite. Requiere DATABASE_URL. */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startMockSerpent } from "./testing/mockSerpent";

const hasDb = Boolean(process.env.DATABASE_URL);
let mock: Awaited<ReturnType<typeof startMockSerpent>>;
let projectId = "";

before(async () => {
  if (!hasDb) return;
  mock = await startMockSerpent();
  process.env.SERPENT_API_KEY = "test-key";
  process.env.SERPENT_BASE_URL = mock.url;
  const { db } = await import("./db");
  const ws = await db.workspace.create({ data: { name: "test-exp" } });
  projectId = (await db.project.create({ data: { workspaceId: ws.id, name: "t", domain: "exp.cl", settings: { keywords: { autocomplete: false, useGsc: false, serpTop: 0, serpExpansion: 3 } } } })).id;
});

after(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  await db.apiCall.deleteMany({ where: { projectId } });
  await db.project.delete({ where: { id: projectId } }).catch(() => {});
  await db.workspace.deleteMany({ where: { name: "test-exp" } });
  await mock.close();
  await db.$disconnect();
});

test("2ª ronda: PAA y related de los términos descubiertos, con límite", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  const { runKeywordPipeline } = await import("./keywords/pipeline");
  const run = await db.keywordRun.create({ data: { projectId, seeds: ["botas"], threshold: 0 } });
  const stats = await runKeywordPipeline(run.id);
  // 1ª ronda: seed → 2 related + 2 PAA. 2ª ronda: 3 de esos (límite) → cada uno aporta 4 más.
  const deepCalls = mock.hits.filter((h) => h.path === "/api/search").map((h) => h.q);
  assert.equal(deepCalls[0], "botas");
  assert.equal(deepCalls.length, 1 + 3);
  assert.deepEqual(deepCalls.slice(1), ["botas barato", "botas chile", "¿qué es botas?"]);
  assert.equal(stats.serpRound2, 3);
  const terms = (await db.keyword.findMany({ where: { projectId } })).map((k) => k.term);
  assert.ok(terms.includes("botas barato chile"), "related de 2ª ronda");
  assert.ok(terms.includes("¿qué es botas barato?"), "PAA de 2ª ronda");
  assert.equal(stats.expanded, 1 + 4 + 3 * 4);
  const r = await db.keywordRun.findUniqueOrThrow({ where: { id: run.id } });
  const src = r.sources as any;
  assert.deepEqual([src.serp, src.embeddings, src.volumes, src.gsc], ["real", "trigram-hash", "none", "none"]);
  // sin credenciales la cadena de volumen termina en el CSV y lo registra
  assert.equal(src.volumeProvider, "csv");
  assert.deepEqual(src.volumeSkipped.map((x: string) => x.split(":")[0]), ["dataforseo", "apify"]);
});
