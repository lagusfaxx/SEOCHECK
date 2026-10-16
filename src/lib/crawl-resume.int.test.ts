import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "./db";
import { runCrawl } from "./audit/crawler";
import { module as crawlpro } from "./pro/crawlpro";
import type { ProCtx } from "./pro/types";

const enabled = Boolean(process.env.DATABASE_URL);
let workspaceId = "",
  projectId = "",
  owner = "";
const ctx = (body: unknown): ProCtx => ({ id: projectId, user: { id: owner, email: "o@example.invalid" }, admin: false, body, url: new URL("https://app.example.invalid") });

before(async () => {
  if (!enabled) return;
  workspaceId = (await db.workspace.create({ data: { name: "crawl resume" } })).id;
  owner = (await db.user.create({ data: { email: `resume-${workspaceId}@example.invalid`, passwordHash: "x" } })).id;
  await db.membership.create({ data: { userId: owner, workspaceId, role: "owner" } });
  // dominio reservado (.invalid): no resuelve, así el test no sale a la red
  projectId = (await db.project.create({ data: { workspaceId, name: "Resume", domain: "resume.invalid" } })).id;
});
after(async () => {
  if (!enabled) return;
  await db.workspace.deleteMany({ where: { id: workspaceId } });
  await db.user.deleteMany({ where: { id: owner } });
});

test("pausa: solo un crawl en curso; reanudar exige pausa", { skip: !enabled }, async () => {
  const c = await db.crawl.create({ data: { projectId, status: "running" } });
  await crawlpro.routes.POST!.pause(ctx({ crawlId: c.id }));
  assert.equal((await db.crawl.findUniqueOrThrow({ where: { id: c.id } })).status, "pausing");
  await assert.rejects(crawlpro.routes.POST!.resume(ctx({ crawlId: c.id })), /no está en pausa/);
  await assert.rejects(crawlpro.routes.POST!.pause(ctx({ crawlId: "otro" })), /no encontrado/);
  await db.crawl.delete({ where: { id: c.id } });
});

test("reanudar: conserva las páginas ya leídas y termina el crawl con su cola", { skip: !enabled }, async () => {
  const home = "https://resume.invalid/";
  const c = await db.crawl.create({
    data: {
      projectId,
      status: "queued",
      frontier: { queue: [], next: [], seen: [[home, 0], ["https://resume.invalid/a", 1]], depth: 1 },
    },
  });
  await db.page.createMany({
    data: [
      { crawlId: c.id, url: home, finalUrl: home, status: 200, contentType: "text/html", title: "Inicio", h1: ["Inicio"], links: ["https://resume.invalid/a"], wordCount: 300, template: "home", linkDetails: [{ to: "https://resume.invalid/a", anchor: "A", zone: "content", nofollow: false }], responseHtml: "<html></html>" },
      { crawlId: c.id, url: "https://resume.invalid/a", finalUrl: "https://resume.invalid/a", status: 200, contentType: "text/html", title: "A", h1: ["A"], links: [], wordCount: 300, canonical: "https://resume.invalid/a", canonicalType: "self" },
    ],
  });
  const res = await runCrawl(c.id);
  assert.equal(res.status, "completed");
  const after = await db.crawl.findUniqueOrThrow({ where: { id: c.id }, include: { pages: true } });
  assert.equal(after.frontier, null);
  assert.equal(after.pages.length, 2);
  const a = after.pages.find((p) => p.url.endsWith("/a"))!;
  assert.equal(a.inlinks, 1);
  assert.equal(a.depth, 1);
  const h = after.pages.find((p) => p.url === home)!;
  assert.equal(h.responseHtml, "<html></html>");
  assert.deepEqual((h.linkDetails as any[]).map((l) => l.zone), ["content"]);
});
