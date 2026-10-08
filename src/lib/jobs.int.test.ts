/**
 * Trabajos colgados: reinicio del worker, pulso, cancelación.
 * Requiere DATABASE_URL (si no está, se omite).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const hasDb = Boolean(process.env.DATABASE_URL);
let projectId = "";

before(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  const ws = await db.workspace.create({ data: { name: "test" } });
  projectId = (await db.project.create({ data: { workspaceId: ws.id, name: "j", domain: "jobs.cl" } })).id;
});

after(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  await db.project.deleteMany({ where: { id: projectId } });
  const { getBoss } = await import("./queue");
  await (await getBoss()).stop({ graceful: false, wait: true }).catch(() => {});
  await db.$disconnect();
});

test("reinicio del worker: lo que estaba corriendo queda interrumpido, lo en cola sigue", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  const { recoverInterrupted } = await import("./jobs");
  const running = await db.jobRun.create({ data: { projectId, kind: "audit.crawl", status: "running", progress: 40 } });
  const queued = await db.jobRun.create({ data: { projectId, kind: "audit.crawl", status: "queued" } });
  const crawl = await db.crawl.create({ data: { projectId, status: "running" } });
  await recoverInterrupted();
  const r = await db.jobRun.findUniqueOrThrow({ where: { id: running.id } });
  assert.equal(r.status, "error");
  assert.match(r.message ?? "", /worker se reinició/);
  assert.equal((await db.jobRun.findUniqueOrThrow({ where: { id: queued.id } })).status, "queued");
  assert.equal((await db.crawl.findUniqueOrThrow({ where: { id: crawl.id } })).status, "error");
});

test("sin pulso por 5 min: se marca colgado; con pulso reciente, no", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  const { sweepStale, workerAlive, beat } = await import("./jobs");
  const old = await db.jobRun.create({ data: { projectId, kind: "gsc.sync", status: "running" } });
  const fresh = await db.jobRun.create({ data: { projectId, kind: "gsc.sync", status: "running" } });
  await db.$executeRaw`UPDATE "JobRun" SET "updatedAt" = now() - interval '6 minutes' WHERE id = ${old.id}`;
  assert.equal(await sweepStale(projectId), 1);
  assert.equal((await db.jobRun.findUniqueOrThrow({ where: { id: old.id } })).status, "error");
  assert.equal((await db.jobRun.findUniqueOrThrow({ where: { id: fresh.id } })).status, "running");

  await beat();
  assert.equal(await workerAlive(), true);
  assert.equal(await workerAlive(Date.now() + 3 * 60_000), false);
});

test("cancelar: sale de pg-boss y queda marcado", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  const { enqueue, cancelJob, QUEUES, getBoss } = await import("./queue");
  const run = await enqueue(projectId, QUEUES.alerts, {});
  assert.ok(run.bossId);
  await cancelJob(run.id);
  const r = await db.jobRun.findUniqueOrThrow({ where: { id: run.id } });
  assert.equal(r.status, "error");
  assert.equal(r.message, "Cancelado");
  const job = await (await getBoss()).getJobById(QUEUES.alerts, run.bossId!);
  assert.equal(job?.state, "cancelled");
});
