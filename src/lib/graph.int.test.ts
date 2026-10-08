/**
 * Explorador: transformaciones sobre datos guardados (sin APIs externas).
 * Requiere DATABASE_URL (si no está, se omite).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const hasDb = Boolean(process.env.DATABASE_URL);
let projectId = "";
const HOME = "https://mi-sitio.cl/";
const CAT = "https://mi-sitio.cl/masajes";

before(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  const ws = await db.workspace.create({ data: { name: "test" } });
  projectId = (await db.project.create({ data: { workspaceId: ws.id, name: "g", domain: "mi-sitio.cl" } })).id;
  const crawl = await db.crawl.create({ data: { projectId, status: "completed" } });
  await db.page.createMany({
    data: [
      { crawlId: crawl.id, url: HOME, status: 200, links: [CAT], inlinks: 0 },
      { crawlId: crawl.id, url: CAT, status: 200, links: [], inlinks: 1 },
    ],
  });
  await db.issue.create({ data: { crawlId: crawl.id, url: CAT, code: "h1_missing", severity: "warning" } });
  const organic = (k: string) => [
    { position: 1, url: `https://rival.cl/${k}`, domain: "rival.cl" },
    { position: 2, url: `https://www.mi-sitio.cl/masajes`, domain: "mi-sitio.cl" },
    { position: 3, url: `https://otro.cl/${k}`, domain: "otro.cl" },
  ];
  for (const k of ["masajes", "spa"]) await db.serpSnapshot.create({ data: { projectId, keyword: k, organic: organic(k), paa: ["¿qué es un spa?"], related: [], features: [] } });
});

after(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  await db.project.deleteMany({ where: { id: projectId } });
  await db.$disconnect();
});

test("explorador: competidores, SERP, enlaces internos, problemas y búsqueda", { skip: !hasDb }, async () => {
  const { expand, graphSearch } = await import("./graph");
  const comp = await expand(projectId, "site", "mi-sitio.cl", "competitors");
  // el propio sitio (con www) no cuenta como competidor
  assert.deepEqual(comp.nodes.map((n) => n.key).sort(), ["otro.cl", "rival.cl"]);
  assert.equal(comp.nodes[0].sub, "en 2 keywords");

  const serp = await expand(projectId, "keyword", "spa", "serp");
  assert.equal(serp.nodes.length, 3);
  const own = serp.nodes.find((n) => n.own)!;
  assert.equal(own.label, "/masajes");
  assert.deepEqual(serp.edges.find((e) => e.target === own.id)?.label, "#2");

  const inl = await expand(projectId, "page", CAT, "inlinks");
  assert.deepEqual(inl.nodes.map((n) => n.key), [HOME]);
  assert.equal(inl.edges[0].target, `page:${CAT}`); // la flecha va de quien enlaza a la página

  const iss = await expand(projectId, "page", CAT, "issues");
  assert.equal(iss.nodes[0].label, "Sin H1");

  const kws = await expand(projectId, "domain", "rival.cl", "keywords");
  assert.deepEqual(kws.nodes.map((n) => n.key).sort(), ["masajes", "spa"]);

  const none = await expand(projectId, "site", "mi-sitio.cl", "topics");
  assert.equal(none.note, "Sin research de keywords");

  const found = await graphSearch(projectId, "masa");
  assert.ok(found.some((n) => n.type === "page" && n.key === CAT));
});
