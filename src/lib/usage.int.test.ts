/** Tokens y costo del LLM quedan en ProviderUsage con el proyecto del job. Requiere DATABASE_URL. */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

test("OpenAI: tokens de entrada/salida y costo en ProviderUsage", { skip: !process.env.DATABASE_URL }, async () => {
  const srv = http.createServer((_q, res) =>
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ model: "gpt-4o-mini", choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 3000, completion_tokens: 1000, prompt_tokens_details: { cached_tokens: 1000 } } }))
  );
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const { env } = await import("./env");
  (env as any).openaiKey = "k";
  (env as any).llmModel = "gpt-4o-mini";
  const { db } = await import("./db");
  const { runWithJob } = await import("./jobctx");
  const { OpenAILLM } = await import("./providers/llm");
  const ws = await db.workspace.create({ data: { name: "test-usage" } });
  const p = await db.project.create({ data: { workspaceId: ws.id, name: "u", domain: "u.cl" } });
  await runWithJob(undefined, () => new OpenAILLM(`http://127.0.0.1:${(srv.address() as any).port}/v1`).json("s", "u"), p.id);
  srv.close();
  const row = await db.providerUsage.findFirstOrThrow({ where: { projectId: p.id } });
  assert.deepEqual([row.provider, row.endpoint, row.model, row.inputTokens, row.outputTokens], ["llm", "openai/chat.completions", "gpt-4o-mini", 3000, 1000]);
  assert.ok(Math.abs(row.costUsd! - (2000 * 0.15 + 1000 * 0.075 + 1000 * 0.6) / 1e6) < 1e-12);
  await db.providerUsage.deleteMany({ where: { projectId: p.id } });
  await db.project.delete({ where: { id: p.id } });
  await db.workspace.delete({ where: { id: ws.id } });
  await db.$disconnect();
});
