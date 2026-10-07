/**
 * Aceptación punto 6: mover una keyword, re-correr el research y que siga donde la dejé.
 * Requiere DATABASE_URL. SERP simulado; autocomplete desactivado para que sea determinista.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startMockSerpent } from "./testing/mockSerpent";

const hasDb = Boolean(process.env.DATABASE_URL);
let mock: Awaited<ReturnType<typeof startMockSerpent>>;
let projectId = "";

// Dos familias de SERP: "trail*" comparten URLs A, "running*" comparten URLs B.
const A = Array.from({ length: 10 }, (_, i) => ({ url: `https://trail${i}.cl/` }));
const B = Array.from({ length: 10 }, (_, i) => ({ url: `https://run${i}.cl/` }));

before(async () => {
  if (!hasDb) return;
  mock = await startMockSerpent({ organicFor: (q) => (q.includes("running") ? B : A) });
  process.env.SERPENT_API_KEY = "test-key";
  process.env.SERPENT_BASE_URL = mock.url;
  const { db } = await import("./db");
  const ws = await db.workspace.create({ data: { name: "test-locks" } });
  projectId = (await db.project.create({ data: { workspaceId: ws.id, name: "t", domain: "locks.cl", settings: { keywords: { autocomplete: false, useGsc: false, serpTop: 50 } } } })).id;
});

after(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  await db.providerUsage.deleteMany({ where: { projectId } });
  await db.project.delete({ where: { id: projectId } }).catch(() => {});
  await db.workspace.deleteMany({ where: { name: "test-locks" } });
  await mock.close();
  await db.$disconnect();
});

test("ediciones manuales sobreviven al re-run", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  const { runKeywordPipeline, refreshCluster } = await import("./keywords/pipeline");
  const run = await db.keywordRun.create({ data: { projectId, seeds: ["zapatillas trail", "zapatillas running"], threshold: 0 } });
  await runKeywordPipeline(run.id);

  const kw = (t: string) => db.keyword.findFirstOrThrow({ where: { projectId, term: t } });
  const trail = await kw("zapatillas trail");
  const running = await kw("zapatillas running");
  assert.ok(trail.clusterId && running.clusterId && trail.clusterId !== running.clusterId, "familias en clusters distintos");

  // Mover a mano una keyword de la familia trail al cluster de running (como hace la UI)
  const moved = (await db.keyword.findMany({ where: { projectId, clusterId: trail.clusterId, term: { not: "zapatillas trail" } } }))[0];
  assert.ok(moved, "hay otra keyword en el cluster trail");
  await db.keyword.update({ where: { id: moved.id }, data: { clusterId: running.clusterId, locked: true } });
  await refreshCluster(trail.clusterId!);
  await refreshCluster(running.clusterId!);

  // Renombrar el cluster destino y su topic, y marcar pillar a mano
  await db.cluster.update({ where: { id: running.clusterId! }, data: { name: "Running (mi nombre)", nameLocked: true, isPillar: true, pillarLocked: true } });
  const runningCluster = await db.cluster.findUniqueOrThrow({ where: { id: running.clusterId! } });
  await db.topic.update({ where: { id: runningCluster.topicId! }, data: { name: "Topic running (mío)", nameLocked: true } });

  // Re-run del mismo research
  await runKeywordPipeline(run.id);

  const after = await db.keyword.findUniqueOrThrow({ where: { id: moved.id } });
  assert.equal(after.clusterId, running.clusterId, "la keyword movida sigue donde la dejé");
  assert.equal(after.locked, true);
  const c = await db.cluster.findUniqueOrThrow({ where: { id: running.clusterId! } });
  assert.equal(c.name, "Running (mi nombre)");
  assert.equal(c.isPillar, true);
  const t = await db.topic.findUniqueOrThrow({ where: { id: c.topicId! } });
  assert.equal(t.name, "Topic running (mío)");
  // Lo no bloqueado se reasigna: "zapatillas running" vuelve a su cluster (ancla primaria)
  assert.equal((await kw("zapatillas running")).clusterId, running.clusterId);
  // Lo no bloqueado de trail sigue agrupado aparte
  const trailAfter = await kw("zapatillas trail");
  assert.ok(trailAfter.clusterId && trailAfter.clusterId !== running.clusterId);
  const r = await db.keywordRun.findUniqueOrThrow({ where: { id: run.id } });
  assert.equal((r.stats as any).locked, 1);
});
