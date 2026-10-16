import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "./db";
import { refresh } from "./pro/data";
import { runAfterCrawl } from "./pro";
import { requireProject, requireProjectWrite } from "./auth";
import { queueNotice, deliverNotices } from "./pro/notifications";
import { module as ops } from "./pro/ops";
import type { ProCtx } from "./pro/types";
const enabled = Boolean(process.env.DATABASE_URL);
let workspaceId = "",
  projectId = "",
  other = "",
  crawlId = "",
  owner = "",
  viewer = "",
  excluded = "",
  hookId = "";
const context = (
  id = projectId,
  userId = owner,
  body: unknown = {},
): ProCtx => ({
  id,
  user: { id: userId, email: "owner@example.invalid" },
  admin: false,
  body,
  url: new URL("https://app.example.invalid"),
});
before(async () => {
  if (!enabled) return;
  const ws = await db.workspace.create({ data: { name: "pro integration" } });
  workspaceId = ws.id;
  const users = await Promise.all(
    ["owner", "viewer", "excluded"].map((name) =>
      db.user.create({
        data: {
          email: `pro-${name}-${ws.id}@example.invalid`,
          passwordHash: "not-used",
        },
      }),
    ),
  );
  [owner, viewer, excluded] = users.map((u) => u.id);
  await db.membership.createMany({
    data: users.map((u, i) => ({
      userId: u.id,
      workspaceId,
      role: i === 0 ? "owner" : "member",
    })),
  });
  projectId = (
    await db.project.create({
      data: { workspaceId, name: "Taupoc", domain: "taupoc.cl" },
    })
  ).id;
  other = (
    await db.project.create({
      data: { workspaceId, name: "Other", domain: "other.cl" },
    })
  ).id;
  await db.projectAccess.create({
    data: { projectId, userId: viewer, role: "viewer" },
  });
  const crawl = await db.crawl.create({
    data: { projectId, status: "completed", finishedAt: new Date() },
  });
  crawlId = crawl.id;
  await db.page.create({
    data: {
      crawlId,
      url: "https://taupoc.cl/products/taza",
      status: 200,
      title: "Taza",
      h1: ["Taza"],
      jsonldTypes: ["Product"],
      links: [],
      schemaIssues: [],
      template: "product",
      responseHtml: "<h1>Taza</h1>",
      commerce: { availability: "OutOfStock" },
    },
  });
});
after(async () => {
  if (!enabled) return;
  await db.workspace.delete({ where: { id: workspaceId } });
  await db.user.deleteMany({
    where: { id: { in: [owner, viewer, excluded] } },
  });
  await db.$disconnect();
});

test(
  "pro: después de crawl crea snapshots utilizables de los módulos",
  { skip: !enabled },
  async () => {
    await runAfterCrawl(crawlId, projectId);
    const s = await db.proSnapshot.findMany({ where: { projectId } });
    for (const kind of [
      "crawl",
      "templates",
      "structure",
      "index",
      "arch",
      "perf",
      "shop",
      "serp",
      "content",
      "analytics",
    ])
      assert.ok(
        s.some((s) => s.kind === kind),
        kind,
      );
    const shop = s.find((s) => s.kind === "shop")!.data as any;
    assert.ok(shop.rows.some((r: any) => /agotado|descontinuado/i.test(r.tipo)));
  },
);
test(
  "pro: viewer puede leer, no escribir; usuario excluido no ve el proyecto",
  { skip: !enabled },
  async () => {
    await requireProject(viewer, projectId);
    await assert.rejects(
      () => requireProjectWrite(viewer, projectId),
      /Solo puedes/,
    );
    await assert.rejects(
      () => requireProject(excluded, projectId),
      /no existe/,
    );
    await requireProjectWrite(owner, projectId);
  },
);
test(
  "pro: un miembro no crea integraciones y las plantillas no cruzan proyectos",
  { skip: !enabled },
  async () => {
    await assert.rejects(
      () =>
        ops.routes.POST!.template(
          context(projectId, viewer, { name: "a", title: "a", reason: "a" }),
        ),
      /rol/,
    );
    const t: any = await ops.routes.POST!.template(
      context(projectId, owner, {
        name: "Producto",
        title: "Revisar stock",
        reason: "Verificar disponibilidad y schema",
      }),
    );
    await assert.rejects(
      () =>
        ops.routes.POST!["template/apply"](context(other, owner, { id: t.id })),
      /no encontrada/,
    );
    const task: any = await ops.routes.POST!["template/apply"](
      context(projectId, owner, { id: t.id }),
    );
    assert.equal(task.projectId, projectId);
    assert.equal(task.title, "Revisar stock");
  },
);
test(
  "pro: webhook crea entregas idempotentes; falla, reintenta y registra éxito sin red real",
  { skip: !enabled },
  async () => {
    const h = await db.webhook.create({
      data: {
        projectId,
        url: "https://example.invalid/hook",
        secret: "test-only",
        events: ["daily.digest"],
      },
    });
    hookId = h.id;
    await queueNotice(projectId, "daily.digest", "today-test", {
      message: "Tarea de prueba",
    });
    await queueNotice(projectId, "daily.digest", "today-test", {
      message: "Tarea de prueba",
    });
    assert.equal(
      await db.webhookDelivery.count({ where: { webhookId: hookId } }),
      1,
    );
    await deliverNotices((async () => {
      throw new Error("test failure");
    }) as any);
    let d = await db.webhookDelivery.findFirstOrThrow({
      where: { webhookId: hookId },
    });
    assert.equal(d.status, "pending");
    assert.equal(d.attempts, 1);
    assert.match(d.lastError!, /test failure/);
    await db.webhookDelivery.update({
      where: { id: d.id },
      data: { nextAt: new Date(0) },
    });
    const sent: { body: string; signature: string }[] = [];
    await deliverNotices((async (_url: string, init: any) => {
      sent.push({
        body: init.body,
        signature: init.headers["X-Seocheck-Signature"],
      });
      return {
        res: { ok: true, status: 200, body: { cancel: async () => {} } },
      };
    }) as any);
    d = await db.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
    assert.equal(d.status, "sent");
    assert.equal(d.attempts, 2);
    assert.equal(sent.length, 1);
    assert.match(sent[0].signature, /^sha256=/);
    await deliverNotices((async () => {
      throw new Error("must not resend");
    }) as any);
  },
);
test(
  "pro: revocar token es por proyecto y la API nunca guarda el token en claro",
  { skip: !enabled },
  async () => {
    const created: any = await ops.routes.POST!.token(
      context(projectId, owner, { name: "Dashboard" }),
    );
    assert.equal(created.token.length, 43);
    const stored = await db.apiToken.findUniqueOrThrow({
      where: { id: created.id },
    });
    assert.notEqual(stored.tokenHash, created.token);
    await ops.routes.DELETE!.token(context(other, owner, { id: created.id }));
    assert.equal(
      (await db.apiToken.findUniqueOrThrow({ where: { id: created.id } }))
        .revokedAt,
      null,
    );
    await ops.routes.DELETE!.token(
      context(projectId, owner, { id: created.id }),
    );
    assert.ok(
      (await db.apiToken.findUniqueOrThrow({ where: { id: created.id } }))
        .revokedAt,
    );
  },
);
test(
  "pro: evidencia de respuestas se conserva en DB y análisis no incluye el HTML",
  { skip: !enabled },
  async () => {
    const evidence = await db.page.findFirstOrThrow({ where: { crawlId } });
    assert.equal(evidence.responseHtml, "<h1>Taza</h1>");
    const r = await refresh("crawl", projectId);
    assert.ok(!JSON.stringify(r).includes("<h1>"));
  },
);
