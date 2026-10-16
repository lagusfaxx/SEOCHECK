import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "./db";
import { env } from "./env";
import { measuredPlan, generateAdvice, adviceReport } from "./advice/service";
import { runWithJob } from "./jobctx";
import { module as advice } from "./pro/advice";
const enabled = Boolean(process.env.DATABASE_URL);
let ws = "",
  id = "",
  user = "",
  viewer = "",
  task = "";
const oldKey = env.openaiKey;
before(async () => {
  if (!enabled) return;
  ws = (await db.workspace.create({ data: { name: "advice integration" } })).id;
  id = (
    await db.project.create({
      data: {
        workspaceId: ws,
        name: "Tienda",
        domain: "taupoc.cl",
        settings: {
          advice: { siteType: "ecommerce", goal: "sales", aiEnabled: true },
        },
      },
    })
  ).id;
  user = (
    await db.user.create({
      data: { email: `advice-${ws}@example.invalid`, passwordHash: "not-used" },
    })
  ).id;
  viewer = (
    await db.user.create({
      data: {
        email: `advice-viewer-${ws}@example.invalid`,
        passwordHash: "not-used",
      },
    })
  ).id;
  await db.membership.createMany({
    data: [
      { workspaceId: ws, userId: user, role: "owner" },
      { workspaceId: ws, userId: viewer, role: "member" },
    ],
  });
  await db.projectAccess.create({
    data: { projectId: id, userId: viewer, role: "viewer" },
  });
  const c = await db.crawl.create({
    data: {
      projectId: id,
      status: "completed",
      startedAt: new Date("2026-10-15"),
      finishedAt: new Date(),
    },
  });
  await db.page.create({
    data: {
      crawlId: c.id,
      url: "https://taupoc.cl/products/taza",
      status: 200,
      h1: ["Taza"],
      jsonldTypes: ["Product"],
      links: [],
      schemaIssues: [],
      template: "product",
    },
  });
  task = (
    await db.projectTask.create({
      data: {
        projectId: id,
        title: "Error",
        fingerprint: "current",
        source: "crawl",
        code: "http_4xx",
        severity: "critical",
        priority: 300,
        reason: "HTTP 404 observado",
        lastCrawlId: c.id,
      },
    })
  ).id;
  const privateCrawl = await db.crawl.create({
    data: {
      projectId: id,
      status: "completed",
      private: true,
      startedAt: new Date("2026-10-16"),
      finishedAt: new Date(),
    },
  });
  await db.projectTask.create({
    data: {
      projectId: id,
      title: "PRIVATE",
      fingerprint: "private",
      source: "crawl",
      reason: "PRIVATE DATA",
      lastCrawlId: privateCrawl.id,
    },
  });
  (env as any).openaiKey = "test-only";
});
after(async () => {
  (env as any).openaiKey = oldKey;
  if (!enabled) return;
  await db.workspace.delete({ where: { id: ws } });
  await db.user.deleteMany({ where: { id: { in: [user, viewer] } } });
  await db.$disconnect();
});
test(
  "plan medido usa el último crawl público y excluye tareas privadas",
  { skip: !enabled },
  async () => {
    const p = await measuredPlan(id);
    assert.equal(p.effectiveType, "ecommerce");
    assert.equal(p.actions.length, 1);
    assert.ok(!JSON.stringify(p).includes("PRIVATE"));
  },
);
test(
  "IA: caché evita llamadas repetidas, cambia con la evidencia y un error conserva el plan medido",
  { skip: !enabled },
  async () => {
    let calls = 0;
    const provider = {
      json: async () => {
        calls++;
        const p = await measuredPlan(id);
        return {
          recommendations: [
            {
              id: p.actions[0].id,
              explanation: "La página observada respondió con error.",
              steps: ["Revisa el destino."],
              verify: "Repite la auditoría.",
              evidenceIds: [p.actions[0].evidence[0].id],
            },
          ],
        };
      },
    };
    await runWithJob(undefined, () => generateAdvice(id, provider as any), id);
    await runWithJob(undefined, () => generateAdvice(id, provider as any), id);
    assert.equal(calls, 1);
    assert.equal((await adviceReport(id)).ai.state, "ready");
    await db.projectTask.update({
      where: { id: task },
      data: { reason: "HTTP 404 en una nueva revisión" },
    });
    await runWithJob(undefined, () => generateAdvice(id, provider as any), id);
    assert.equal(calls, 2);
    await db.projectTask.update({
      where: { id: task },
      data: { reason: "HTTP 404: nueva evidencia" },
    });
    await runWithJob(
      undefined,
      () =>
        generateAdvice(id, {
          json: async () => ({ recommendations: [{ id: "inventado" }] }),
        } as any),
      id,
    );
    const report = await adviceReport(id);
    assert.equal(report.ai.state, "error");
    assert.equal(
      report.actions[0].title,
      "Recuperar las páginas que ya no abren",
    );
    assert.equal(report.actions[0].ai, undefined);
  },
);
test(
  "un viewer no puede encolar análisis ni cambiar el perfil",
  { skip: !enabled },
  async () => {
    const context = {
      id,
      user: { id: viewer, email: "viewer@example.invalid" },
      admin: false,
      body: { siteType: "services" },
      url: new URL("https://app.example.invalid"),
    };
    await assert.rejects(
      () => advice.routes.POST!.analyze(context),
      /Solo puedes/,
    );
    await assert.rejects(() => advice.routes.PATCH!.profile(context), /rol/);
  },
);
