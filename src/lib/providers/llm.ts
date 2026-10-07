import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import { jobLog } from "../jobctx";
import { logUsage } from "../costs";
import { llmCost } from "../pricing";
import { fetchT } from "../util";
import type { LLMProvider } from "./types";

function extractJson<T>(text: string): T {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (m ? m[1] : text).trim();
  const start = raw.search(/[\[{]/);
  return JSON.parse(start > 0 ? raw.slice(start) : raw) as T;
}

export class LLMRefusal extends Error {
  constructor(public model: string, public category: string | null) {
    super(`LLM rechazó la solicitud (${model}${category ? `, categoría ${category}` : ""})`);
    this.name = "LLMRefusal";
  }
}

/**
 * Fallback ante rechazos (server-side, beta `server-side-fallback-2026-07-01`, `fallbacks: "default"`):
 * la API reintenta dentro de la misma llamada en el modelo que Anthropic recomienda para la
 * categoría del rechazo. Con el modelo por defecto `claude-sonnet-5-5`:
 *   - categorías `cyber` y `frontier_llm` → se reintenta en `claude-sonnet-5`;
 *   - `bio`, `reasoning_extraction` y `general_harms` → sin fallback: vuelve `stop_reason: "refusal"`.
 * Con `claude-opus-5-5` los destinos son `claude-opus-5` / `claude-opus-4-8` (cyber → opus-4-8).
 * Los modelos Haiku no tienen fallback server-side: no se envía el parámetro.
 * Cada fallback (bloque `fallback` con from/to) y cada rechazo final quedan en el log del job.
 */
export function fallbackParams(model: string) {
  if (/haiku/.test(model)) return {};
  return { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
}

type LlmEvent = { level: "info" | "warn" | "error"; msg: string; data?: unknown };

/** Interpreta la respuesta: fallbacks ocurridos, rechazo final y texto. */
export function inspectMessage(msg: any, requested: string): { events: LlmEvent[]; refusal: LLMRefusal | null; text: string } {
  const events: LlmEvent[] = [];
  for (const b of msg.content ?? []) {
    if (b.type === "fallback") events.push({ level: "warn", msg: `LLM fallback: ${b.from?.model} rechazó, continuó ${b.to?.model}`, data: { from: b.from, to: b.to } });
  }
  if (msg.stop_reason === "refusal") {
    const category = msg.stop_details?.category ?? null;
    events.push({ level: "error", msg: `LLM rechazo final en ${msg.model} (sin fallback disponible)`, data: { category, explanation: msg.stop_details?.explanation } });
    return { events, refusal: new LLMRefusal(msg.model, category), text: "" };
  }
  if (msg.model && msg.model !== requested) events.push({ level: "info", msg: `LLM respondido por ${msg.model} (pedido ${requested})` });
  return { events, refusal: null, text: (msg.content ?? []).map((b: any) => (b.type === "text" ? b.text : "")).join("") };
}

class AnthropicLLM implements LLMProvider {
  private client = new Anthropic({ apiKey: env.anthropicKey });

  async json<T>(system: string, user: string, maxTokens = 16000, effort: "low" | "medium" | "high" = "low"): Promise<T> {
    const model = env.llmModel;
    const params = {
      model,
      max_tokens: maxTokens,
      system: `${system}\nResponde solo con JSON válido, sin texto adicional.`,
      messages: [{ role: "user" as const, content: user }],
      output_config: { effort },
      ...fallbackParams(model),
    };
    const stream = this.client.beta.messages.stream(params as any);
    const msg: any = await stream.finalMessage();
    const inTok = (msg.usage?.input_tokens ?? 0) + (msg.usage?.cache_read_input_tokens ?? 0) + (msg.usage?.cache_creation_input_tokens ?? 0);
    const outTok = msg.usage?.output_tokens ?? 0;
    const served = msg.model ?? model;
    await logUsage({ provider: "llm", endpoint: "anthropic/messages", model: served, inputTokens: inTok, outputTokens: outTok, costUsd: llmCost(served, inTok, outTok, msg.usage?.cache_read_input_tokens ?? 0) });
    const r = inspectMessage(msg, model);
    for (const e of r.events) await jobLog(e.level, e.msg, e.data);
    if (r.refusal) throw r.refusal;
    return extractJson<T>(r.text);
  }
}

/** OpenAI Chat Completions (JSON mode). Default: gpt-4o-mini. */
class OpenAILLM implements LLMProvider {
  constructor(private base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1") {}

  async json<T>(system: string, user: string, maxTokens = 8000): Promise<T> {
    const model = env.llmModel;
    const res = await fetchT(`${this.base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        // max_completion_tokens vale para gpt-4o-mini y para la familia gpt-5 (que no acepta max_tokens)
        max_completion_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${system}\nResponde solo con JSON válido.` },
          { role: "user", content: user },
        ],
      }),
      timeoutMs: 180_000,
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json: any = await res.json();
    const u = json.usage ?? {};
    const inTok = u.prompt_tokens ?? 0, outTok = u.completion_tokens ?? 0, cached = u.prompt_tokens_details?.cached_tokens ?? 0;
    const served = json.model ?? model;
    await logUsage({ provider: "llm", endpoint: "openai/chat.completions", model: served, inputTokens: inTok, outputTokens: outTok, costUsd: llmCost(served, inTok, outTok, cached) });
    const choice = json.choices?.[0];
    if (choice?.finish_reason === "length") await jobLog("warn", `OpenAI cortó la respuesta por max_completion_tokens (${maxTokens})`);
    if (choice?.message?.refusal) throw new Error(`OpenAI rechazó la solicitud: ${choice.message.refusal}`);
    return extractJson<T>(choice?.message?.content ?? "");
  }
}

export { AnthropicLLM };

export { OpenAILLM };

/** LLM_PROVIDER=openai (default) | anthropic. Sin la clave del proveedor elegido: sin LLM (reglas / brief determinista). */
export function llmProvider(): LLMProvider | null {
  if (env.llmProvider === "anthropic") return env.anthropicKey ? new AnthropicLLM() : null;
  return env.openaiKey ? new OpenAILLM() : null;
}

export function llmStatus() {
  const key = env.llmProvider === "anthropic" ? env.anthropicKey : env.openaiKey;
  return { provider: env.llmProvider, model: env.llmModel, available: Boolean(key), reason: key ? null : `falta ${env.llmProvider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"}` };
}
