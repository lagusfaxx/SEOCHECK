/** Presupuesto mensual: los jobs que no caben fallan antes de llamar a la API. Requiere DATABASE_URL. */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startMockSerpent } from "./testing/mockSerpent";

const hasDb = Boolean(process.env.DATABASE_URL);
let mock: Awaited<ReturnType<typeof startMockSerpent>>;
let projectId = "";

before(async () => {
  if (!hasDb) return;
  mock = await startMockSerpent();
  Object.assign(process.env, { SERPENT_API_KEY: "test-key", SERPENT_BASE_URL: mock.url, TZ: "America/Santiago" });
  const { db } = await import("./db");
  const ws = await db.workspace.create({ data: { name: "test-budget" } });
  projectId = (await db.project.create({ data: { workspaceId: ws.id, name: "b", domain: "b.cl", settings: { keywords: { autocomplete: false, serpTop: 20, serpExpansion: 5 } } } })).id;
});

after(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  await db.providerUsage.deleteMany({ where: { projectId } });
  await db.project.deleteMany({ where: { id: projectId } });
  await db.workspace.deleteMany({ where: { name: "test-budget" } });
  await mock.close();
  await db.$disconnect();
});

test("inicio de mes en la zona horaria (Chile, UTC-3 en octubre)", async () => {
  const { monthStart } = await import("./budget");
  assert.equal(monthStart(new Date("2026-10-07T12:00:00Z"), "America/Santiago").toISOString(), "2026-10-01T03:00:00.000Z");
  assert.equal(monthStart(new Date("2026-10-01T02:00:00Z"), "America/Santiago").toISOString(), "2026-09-01T04:00:00.000Z", "aún es septiembre en Chile (1-sep todavía UTC-4: el horario de verano parte el 6-sep)");
  assert.equal(monthStart(new Date("2026-06-15T12:00:00Z"), "America/Santiago").toISOString(), "2026-06-01T04:00:00.000Z", "invierno: UTC-4");
});

test("assertBudget: falla con mensaje claro si la estimación no cabe; -1 = sin límite", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  const { assertBudget, BudgetError, spentThisMonth } = await import("./budget");
  await db.providerUsage.create({ data: { provider: "llm", endpoint: "openai/chat.completions", units: 1, costUsd: 0.5, projectId } });
  const spent = (await spentThisMonth("llm")).get("llm")!.usd;
  process.env.LLM_MONTHLY_USD = String(spent + 0.01);
  await assert.rejects(assertBudget({ llm: 0.02 }, "Prueba"), (e: any) => e instanceof BudgetError && /llm: gastado \$[\d.]+ de \$[\d.]+, este job necesita hasta \$0\.0200 \(sube LLM_MONTHLY_USD\)/.test(e.message) && /No se llamó a ninguna API/.test(e.message));
  await assertBudget({ llm: 0.005 }, "Prueba"); // cabe
  process.env.LLM_MONTHLY_USD = "-1";
  await assertBudget({ llm: 1e6 }, "Prueba"); // sin límite
  process.env.LLM_MONTHLY_USD = "0";
  await assert.rejects(assertBudget({ llm: 0.0001 }, "Prueba"), BudgetError); // 0 = bloqueado
  delete process.env.LLM_MONTHLY_USD;
});

test("research sin presupuesto de Serpent falla antes de cualquier llamada", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  const { spentThisMonth, BudgetError } = await import("./budget");
  const { runKeywordPipeline } = await import("./keywords/pipeline");
  const spent = (await spentThisMonth("serpent")).get("serpent")?.usd ?? 0;
  // cota del research = (1 seed + 5 expansión + 20 top) × $0.0006 = $0.0156; se deja la mitad disponible
  process.env.SERPENT_MONTHLY_USD = String(spent + 0.0078);
  const run = await db.keywordRun.create({ data: { projectId, seeds: ["botas"], threshold: 0 } });
  const before = mock.hits.length;
  await assert.rejects(runKeywordPipeline(run.id), BudgetError);
  assert.equal(mock.hits.length, before, "ninguna llamada a Serpent");
  assert.equal(await db.keyword.count({ where: { runId: run.id } }), 0, "nada a medio camino");
  process.env.SERPENT_MONTHLY_USD = "-1";
  await runKeywordPipeline(run.id);
  assert.ok(mock.hits.length > before);
  delete process.env.SERPENT_MONTHLY_USD;
});

test("rank tracking semanal por defecto; las weekly corren solo el día configurado", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  const { dueTracked } = await import("./rank/rank");
  const t = await db.trackedKeyword.create({ data: { projectId, keyword: "botas semana" } });
  assert.equal(t.frequency, "weekly");
  const d = await db.trackedKeyword.create({ data: { projectId, keyword: "botas diario", frequency: "daily" } });
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id).filter((x) => x === t.id || x === d.id).sort();
  assert.deepEqual(ids(await dueTracked(projectId, new Date("2026-10-05T15:00:00Z"))), [t.id, d.id].sort(), "lunes: ambas");
  assert.deepEqual(ids(await dueTracked(projectId, new Date("2026-10-07T15:00:00Z"))), [d.id], "miércoles: solo la diaria");
});
