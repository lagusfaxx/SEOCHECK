import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

test("modelo por defecto es claude-sonnet-5-5", async () => {
  delete process.env.LLM_MODEL;
  const { env } = await import("./env");
  assert.equal(env.llmModel, "claude-sonnet-5-5");
});

test("fallback: default para Sonnet/Opus, nada para Haiku", async () => {
  const { fallbackParams } = await import("./providers/llm");
  assert.deepEqual(fallbackParams("claude-sonnet-5-5"), { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  assert.deepEqual(fallbackParams("claude-opus-5-5"), { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  assert.deepEqual(fallbackParams("claude-haiku-5-5"), {});
});

test("inspectMessage registra fallback, modelo servido y rechazo final", async () => {
  const { inspectMessage, LLMRefusal } = await import("./providers/llm");
  const fb = inspectMessage(
    { model: "claude-sonnet-5", stop_reason: "end_turn", content: [{ type: "fallback", from: { model: "claude-sonnet-5-5" }, to: { model: "claude-sonnet-5" } }, { type: "text", text: '{"a":1}' }] },
    "claude-sonnet-5-5"
  );
  assert.equal(fb.refusal, null);
  assert.equal(fb.text, '{"a":1}');
  assert.deepEqual(fb.events.map((e) => e.msg), ["LLM fallback: claude-sonnet-5-5 rechazó, continuó claude-sonnet-5", "LLM respondido por claude-sonnet-5 (pedido claude-sonnet-5-5)"]);

  const ref = inspectMessage({ model: "claude-sonnet-5-5", stop_reason: "refusal", stop_details: { type: "refusal", category: "general_harms", explanation: "x" }, content: [] }, "claude-sonnet-5-5");
  assert.ok(ref.refusal instanceof LLMRefusal);
  assert.equal(ref.refusal!.category, "general_harms");
  assert.equal(ref.events[0].level, "error");
});

test("la request real del SDK lleva modelo, fallbacks y header beta", async () => {
  let captured: { headers: http.IncomingHttpHeaders; body: any } | null = null;
  const srv = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      captured = { headers: req.headers, body: JSON.parse(raw) };
      res.writeHead(200, { "content-type": "text/event-stream" });
      const ev = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: '{"ok":true}' } });
      ev("content_block_stop", { index: 0 });
      ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } });
      ev("message_stop", {});
      res.end();
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  process.env.ANTHROPIC_API_KEY = "test";
  const { env } = await import("./env");
  (env as any).anthropicKey = "test";
  (env as any).llmModel = "claude-sonnet-5-5";
  const { AnthropicLLM } = await import("./providers/llm");
  const out = await new AnthropicLLM().json<{ ok: boolean }>("sys", "user", 1000, "medium");
  srv.close();
  assert.deepEqual(out, { ok: true });
  assert.equal(captured!.body.model, "claude-sonnet-5-5");
  assert.equal(captured!.body.fallbacks, "default");
  assert.deepEqual(captured!.body.output_config, { effort: "medium" });
  assert.equal(captured!.body.thinking, undefined);
  assert.match(String(captured!.headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
});
