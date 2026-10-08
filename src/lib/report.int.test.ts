/**
 * Informe completo: datos sembrados en Postgres → Markdown; y el job "correr todo" con pasos saltados.
 * Requiere DATABASE_URL (si no está, se omite).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const hasDb = Boolean(process.env.DATABASE_URL);
let projectId = "";

before(async () => {
  if (!hasDb) return;
  delete process.env.PAGESPEED_API_KEY;
  delete process.env.GSC_SERVICE_ACCOUNT_JSON;
  const { db } = await import("./db");
  const ws = await db.workspace.create({ data: { name: "test" } });
  const p = await db.project.create({ data: { workspaceId: ws.id, name: "r", domain: "mi-sitio.cl" } });
  projectId = p.id;

  const crawl = await db.crawl.create({
    data: {
      projectId,
      status: "done",
      options: { maxPages: 2 },
      stats: { health: 80, pages: 4, errors: 1, redirects: 0, orphans: 2, sitemap: 4, avgMs: 120, critical: 1, warning: 3, info: 0 },
    },
  });
  await db.issue.createMany({
    data: [
      { crawlId: crawl.id, url: "https://mi-sitio.cl/perfil/ana", code: "title_long", severity: "warning", detail: "78" },
      { crawlId: crawl.id, url: "https://mi-sitio.cl/perfil/bea", code: "title_long", severity: "warning", detail: "81" },
      { crawlId: crawl.id, url: "https://mi-sitio.cl/viejo", code: "http_4xx", severity: "critical", detail: "404" },
      { crawlId: crawl.id, url: "https://mi-sitio.cl/perfil/zoe", code: "orphan", severity: "warning" },
    ],
  });
  const day = (n: number) => new Date(Date.UTC(2026, 8, n));
  await db.gscRow.createMany({
    data: [
      { projectId, date: day(20), query: "masajes providencia", page: "https://mi-sitio.cl/providencia", clicks: 3, impressions: 400, ctr: 0.0075, position: 8.2 },
      { projectId, date: day(21), query: "spa santiago", page: "https://mi-sitio.cl/", clicks: 40, impressions: 600, ctr: 0.066, position: 2.1 },
    ],
  });
  // totales del sitio: más que la suma de filas porque incluyen consultas anonimizadas
  await db.gscDay.createMany({
    data: [
      { projectId, date: day(20), clicks: 60, impressions: 900, ctr: 0.066, position: 7 },
      { projectId, date: day(21), clicks: 50, impressions: 800, ctr: 0.062, position: 3 },
    ],
  });
  const run = await db.keywordRun.create({ data: { projectId, seeds: ["masajes"], status: "done" } });
  await db.cluster.createMany({
    data: [
      { projectId, runId: run.id, name: "masajes las condes", primary: "masajes las condes", volume: 900, score: 9, urls: ["https://otro.cl/a"] },
      { projectId, runId: run.id, name: "masajes providencia", primary: "masajes providencia", volume: 500, score: 8, urls: ["https://www.mi-sitio.cl/providencia"] },
    ],
  });
});

after(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  await db.project.deleteMany({ where: { id: projectId } });
  await db.$disconnect();
});

test("informe: tareas por prioridad, secciones, oportunidades GSC y gaps de keywords", { skip: !hasDb }, async () => {
  const { buildReport } = await import("./report");
  const md = await buildReport(projectId);
  assert.match(md, /^# Informe SEO · mi-sitio\.cl/);
  const tasks = md.slice(md.indexOf("## Tareas"), md.indexOf("## Auditoría"));
  // crítico antes que warning
  assert.ok(tasks.indexOf("Error 4xx") < tasks.indexOf("Title largo"));
  assert.match(tasks, /Title largo\*\* · Warning · 2 URLs \(`\/perfil\/\*` 2\)/);
  // el crawl tocó el límite: aviso y huérfanas marcadas para verificar
  assert.match(md, /llegó al límite de 2 páginas/);
  assert.match(tasks, /Huérfana.*verificar con un crawl completo/);
  // GSC: los totales salen de GscDay (110 clics), no de la suma de filas (43)
  assert.match(md, /\| Actual \| 110 \| 1\.700 \|/);
  // GSC: posición 4–20 con impresiones
  assert.match(md, /\| masajes providencia \| https:\/\/mi-sitio\.cl\/providencia \| 400 \|/);
  // keywords: con URL propia (www) = optimizar; sin URL propia = crear página
  assert.match(md, /masajes providencia \| 500 \| – \| 0 \| optimizar https:\/\/www\.mi-sitio\.cl\/providencia/);
  assert.match(md, /masajes las condes \| 900 \| – \| 0 \| crear página/);
  assert.match(tasks, /Clusters sin página propia\*\* · 1/);
  // anexo con el detalle
  assert.match(md, /- https:\/\/mi-sitio\.cl\/perfil\/ana — 78/);
});

test("correr todo: sigue aunque un paso falle y salta lo que no tiene credenciales", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  await db.project.update({ where: { id: projectId }, data: { domain: "localhost" } });
  const { runFull } = await import("./fullrun");
  const steps = await runFull(projectId, { maxPages: 5 });
  const by = Object.fromEntries(steps.map((s) => [s.step, s]));
  assert.deepEqual(Object.keys(by), ["crawl", "gsc", "inspect", "psi", "keywords", "rank", "alerts"]);
  assert.equal(by.gsc.status, "skipped");
  assert.equal(by.psi.detail, "falta PAGESPEED_API_KEY");
  assert.equal(by.keywords.detail, "sin semillas");
  assert.equal(by.rank.detail, "sin keywords trackeadas");
  assert.equal(by.alerts.status, "ok");
  await db.project.update({ where: { id: projectId }, data: { domain: "mi-sitio.cl" } });
});
