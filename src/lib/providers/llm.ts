import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import type { LLMProvider } from "./types";

function extractJson<T>(text: string): T {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (m ? m[1] : text).trim();
  const start = raw.search(/[\[{]/);
  return JSON.parse(start > 0 ? raw.slice(start) : raw) as T;
}

class AnthropicLLM implements LLMProvider {
  private client = new Anthropic({ apiKey: env.anthropicKey });

  async json<T>(system: string, user: string, maxTokens = 16000): Promise<T> {
    const params = {
      model: env.llmModel,
      max_tokens: maxTokens,
      system: `${system}\nResponde solo con JSON válido, sin texto adicional.`,
      messages: [{ role: "user" as const, content: user }],
      output_config: { effort: "low" as const },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    };
    const stream = this.client.beta.messages.stream(params as any);
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("LLM rechazó la solicitud");
    const text = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
    return extractJson<T>(text);
  }
}

class OpenAILLM implements LLMProvider {
  async json<T>(system: string, user: string, maxTokens = 8000): Promise<T> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${system}\nResponde solo con JSON válido.` },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const json: any = await res.json();
    return extractJson<T>(json.choices[0].message.content);
  }
}

export function llmProvider(): LLMProvider | null {
  if (env.anthropicKey) return new AnthropicLLM();
  if (env.openaiKey) return new OpenAILLM();
  return null;
}
