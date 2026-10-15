/** Avisos inmediatos: noindex nuevo en página con tráfico tras un crawl, sin repetir el aviso. Requiere DATABASE_URL. */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const hasDb = Boolean(process.env.DATABASE_URL);
let projectId = "";
const S = "https://vigilar.cl";

before(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  const ws = await db.workspace.create({ data: { name: "test-watch" } });
  const u = await db.user.create({ data: { email: `dueno-${Date.now()}@test.cl`, passwordHash: "x" } as any });
  await db.membership.create({ data: { userId: u.id, workspaceId: ws.id, role: "owner" } });
  projectId = (await db.project.create({ data: { workspaceId: ws.id, name: "w", domain: "vigilar.cl" } })).id;
  const mk = async (startedAt: Date, noindex: boolean) => {
    const c = await db.crawl.create({ data: { projectId, status: "completed", startedAt, robots: "User-agent: *\nDisallow: /carrito" } });
    await db.page.createMany({ data: [{ crawlId: c.id, url: `${S}/`, status: 200, depth: 0, title: "Inicio" }, { crawlId: c.id, url: `${S}/ventas`, status: 200, depth: 1, title: "Ventas", noindex }] });
  };
  await mk(new Date(Date.now() - 7 * 864e5), false);
  await mk(new Date(), true);
  const day = new Date(Date.UTC(2026, 8, 30));
  await db.gscRow.create({ data: { projectId, date: day, query: "ventas", page: `${S}/ventas`, clicks: 5, impressions: 300, ctr: 0.016, position: 6 } });
});

after(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  await db.project.deleteMany({ where: { id: projectId } });
  await db.user.deleteMany({ where: { email: { startsWith: "dueno-" } } });
  await db.$disconnect();
});

test("avisa una vez el noindex nuevo en una página con tráfico", { skip: !hasDb }, async () => {
  const { runWatch, alertRecipients } = await import("./watch");
  const first = await runWatch(projectId);
  assert.deepEqual(first.map((a) => a.key.split("-").slice(0, 2).join("-")), ["noindex-new"]);
  assert.equal(first[0].urls[0], `${S}/ventas`);
  assert.equal((await runWatch(projectId)).length, 0, "no repite el mismo aviso");
  assert.equal((await alertRecipients(projectId)).length, 1, "por defecto, dueños y admins");
  const { buildReport } = await import("./report");
  assert.match(await buildReport(projectId), /### Cambios desde el crawl anterior[\s\S]*\| noindex \| 1 \|/);
});
