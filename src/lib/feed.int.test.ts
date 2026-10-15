/** Exportación CSV por token y tareas con responsable. Requiere DATABASE_URL. */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const hasDb = Boolean(process.env.DATABASE_URL);
let projectId = "", other = "";
const email = `resp-${Date.now()}@test.cl`;

before(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  const ws = await db.workspace.create({ data: { name: "test-feed" } });
  const u = await db.user.create({ data: { email, passwordHash: "x" } as any });
  await db.membership.create({ data: { userId: u.id, workspaceId: ws.id, role: "member" } });
  projectId = (await db.project.create({ data: { workspaceId: ws.id, name: "f", domain: "feed.cl" } })).id;
  other = (await db.project.create({ data: { workspaceId: ws.id, name: "g", domain: "otro.cl" } })).id;
  await db.gscDay.create({ data: { projectId, date: new Date(Date.UTC(2026, 8, 1)), clicks: 12, impressions: 300, ctr: 0.04, position: 7.5 } });
  await db.ga4Row.create({ data: { projectId, date: new Date(Date.UTC(2026, 8, 1)), landing: "/", sessions: 20, keyEvents: 2, revenue: 59990 } });
  await db.projectTask.create({ data: { projectId, fingerprint: "m1", title: "=HYPERLINK(\"x\")", reason: "r", source: "manual" } });
});

after(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  await db.project.deleteMany({ where: { id: { in: [projectId, other] } } });
  await db.user.deleteMany({ where: { email } });
  await db.$disconnect();
});

test("feed: token por proyecto, rotación revoca el anterior, CSV seguro para hojas de cálculo", { skip: !hasDb }, async () => {
  const { rotateFeedToken, projectByFeedToken, feedCsv, revokeFeedToken } = await import("./feed");
  const t1 = await rotateFeedToken(projectId);
  assert.equal(await projectByFeedToken(t1), projectId);
  const t2 = await rotateFeedToken(projectId);
  assert.equal(await projectByFeedToken(t1), null, "el token anterior deja de funcionar");
  assert.equal(await projectByFeedToken(t2), projectId);
  assert.equal(await projectByFeedToken("corto"), null);
  const daily = await feedCsv(projectId, "diario");
  assert.match(daily, /"2026-09-01","12","300","0.04","7.5","20","2","59990"/);
  const tasks = await feedCsv(projectId, "tareas");
  assert.match(tasks, /"'=HYPERLINK/, "sin inyección de fórmulas");
  await revokeFeedToken(projectId);
  assert.equal(await projectByFeedToken(t2), null);
});

test("tareas: responsable debe ser miembro, con fecha límite", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  const { setTaskAssignment } = await import("./tasks");
  const t = await db.projectTask.findFirstOrThrow({ where: { projectId } });
  await assert.rejects(setTaskAssignment(projectId, t.id, { assignee: "extraño@x.cl", dueAt: null }, false, "yo@x.cl"), /miembro/);
  await setTaskAssignment(projectId, t.id, { assignee: email.toUpperCase(), dueAt: new Date("2026-10-01T23:59:59Z") }, false, "yo@x.cl");
  const after = await db.projectTask.findUniqueOrThrow({ where: { id: t.id } });
  assert.equal(after.assignee, email);
  assert.equal(after.dueAt?.toISOString().slice(0, 10), "2026-10-01");
});
