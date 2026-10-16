/** IA y Google Maps con Serpent simulado: revisión semanal, informe y tareas. Requiere DATABASE_URL. */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const hasDb = Boolean(process.env.DATABASE_URL);
const hits: string[] = [];
let srv: http.Server;
let projectId = "";

before(async () => {
  if (!hasDb) return;
  srv = http.createServer((req, res) => {
    const u = new URL(req.url!, "http://x");
    hits.push(u.pathname);
    const json = (o: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(o));
    if (u.pathname === "/api/ai/rank")
      return json({ results: { chatgpt: { target_found: u.searchParams.get("keyword") === "trajes natacion", target_position: 1, citations: [{ domain: "rival.cl" }] }, perplexity: { target_found: false, citations: [{ domain: "rival.cl" }] } } });
    if (u.pathname === "/api/maps/search/quick") return json({ places: [{ rank: 1, name: "Rival", website: "https://rival.cl", rating: 4.7 }, { rank: 4, name: "Mi Tienda", website: "https://mi-tienda.cl", rating: 4.9 }] });
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  Object.assign(process.env, { SERPENT_API_KEY: "k", SERPENT_BASE_URL: `http://127.0.0.1:${(srv.address() as any).port}`, SERPENT_MONTHLY_USD: "5" });
  const { db } = await import("./db");
  const ws = await db.workspace.create({ data: { name: "test-ai" } });
  projectId = (await db.project.create({ data: { workspaceId: ws.id, name: "ai", domain: "mi-tienda.cl", settings: { local: { location: "Providencia", keywords: ["tienda natacion"] } } } })).id;
  await db.trackedKeyword.createMany({ data: [{ projectId, keyword: "trajes natacion" }, { projectId, keyword: "antiparras" }] });
});

after(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  // el gasto simulado no debe quedar contando para el presupuesto mensual de otros tests
  await db.providerUsage.deleteMany({ where: { projectId } });
  await db.project.deleteMany({ where: { id: projectId } });
  await db.$disconnect();
  srv?.close();
});

test("IA y Google Maps: guarda, reusa en la semana y el informe arma tareas", { skip: !hasDb }, async () => {
  const { runAiVisibility, runLocal, aiLocalOverview } = await import("./ai-local");
  const ai: any = await runAiVisibility(projectId);
  assert.equal(ai.checks, 4);
  assert.ok((await runAiVisibility(projectId) as any).reused);
  await runLocal(projectId);
  const o = await aiLocalOverview(projectId);
  assert.deepEqual(o.ai!.engines.find((e) => e.engine === "chatgpt"), { engine: "chatgpt", total: 2, found: 1, share: 0.5 });
  assert.equal(o.ai!.topCited[0].domain, "rival.cl");
  assert.equal(o.localRanks!.rows[0].position, 4);
  const { buildReport } = await import("./report");
  const md = await buildReport(projectId);
  assert.match(md, /Aparecer en las respuestas de IA para 1 keyword/);
  assert.match(md, /Entrar al top 3 de Google Maps en 1 búsqueda local/);
  assert.equal(hits.filter((h) => h === "/api/ai/rank").length, 2);
});
