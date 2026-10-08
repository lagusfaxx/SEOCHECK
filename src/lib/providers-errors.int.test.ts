/**
 * APIs externas: sin saldo / key inválida no se reintentan; caída y límite de ritmo sí; PageSpeed sigue con las
 * otras URLs si una falla; y la cobertura del informe distingue "falló" de "sin datos".
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { httpFail, netFail, ProviderError } from "./providers/errors";

const hasDb = Boolean(process.env.DATABASE_URL);
const servers: http.Server[] = [];
after(async () => {
  for (const s of servers) s.close();
  if (hasDb) (await import("./db")).db.$disconnect();
});

async function serve(handler: (n: number) => [number, string]) {
  let n = 0;
  const srv = http.createServer((_, res) => {
    const [status, body] = handler(++n);
    res.writeHead(status, { "content-type": "application/json" }).end(body);
  });
  servers.push(srv);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, calls: () => n };
}

test("clasificación de errores HTTP y de red", () => {
  assert.equal(httpFail("Serpent", 402).kind, "no_balance");
  assert.equal(httpFail("Serpent", 401).kind, "auth");
  assert.equal(httpFail("Serpent", 429).kind, "rate_limit");
  assert.equal(httpFail("Serpent", 503).kind, "down");
  assert.equal(httpFail("Serpent", 400, "bad q").kind, "bad_request");
  assert.equal(netFail("X", Object.assign(new Error("aborted"), { name: "AbortError" })).kind, "timeout");
  assert.equal(netFail("X", Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } })).kind, "down");
  assert.equal(httpFail("X", 503).transient, true);
  assert.equal(httpFail("X", 402).transient, false);
});

test("Serpent: sin saldo corta al primer intento; caída se reintenta", async () => {
  const { env } = await import("./env");
  const { SerpentProvider } = await import("./providers/serpent");
  (env as any).serpentKey = "k";
  const broke = await serve(() => [402, '{"error":"insufficient credits"}']);
  (env as any).serpentBase = broke.url;
  await assert.rejects(() => new SerpentProvider().quick("x", { country: "cl", language: "es" } as any), (e: any) => e instanceof ProviderError && e.kind === "no_balance");
  assert.equal(broke.calls(), 1);
  const flaky = await serve((n) => (n < 3 ? [503, "{}"] : [200, JSON.stringify({ success: true, results: { organic: [{ position: 1, url: "https://a.cl/", title: "a" }] } })]));
  (env as any).serpentBase = flaky.url;
  const r = await new SerpentProvider().quick("x", { country: "cl", language: "es" } as any);
  assert.equal(r.organic.length, 1);
  assert.equal(flaky.calls(), 3);
});

test("cobertura: un módulo cuyo último intento falló se marca como falló, no como sin datos", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  const { coverage } = await import("./coverage");
  const ws = await db.workspace.create({ data: { name: "cov" } });
  const p = await db.project.create({ data: { workspaceId: ws.id, name: "c", domain: "cov.cl" } });
  try {
    await db.crawl.create({ data: { projectId: p.id, status: "failed", reason: "No se pudo acceder al sitio: el dominio no resuelve (DNS)." } });
    await db.jobRun.create({ data: { projectId: p.id, kind: "audit.psi", status: "error", message: "PageSpeed no pudo medir ninguna URL" } });
    await db.psiResult.create({ data: { projectId: p.id, url: "https://cov.cl/", strategy: "mobile", score: 50, lab: {}, field: {} } });
    const c = Object.fromEntries((await coverage(p.id)).map((m) => [m.key, m]));
    assert.equal(c.crawl.state, "failed");
    assert.match(c.crawl.detail, /DNS/);
    assert.equal(c.psi.state, "failed");
    assert.equal(c.keywords.state, "never");
    assert.equal(c.gsc.state, "missing");
  } finally {
    await db.workspace.delete({ where: { id: ws.id } });
  }
});
