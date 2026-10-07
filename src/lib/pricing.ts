/**
 * Tarifas para calcular costo y presupuesto. Fuentes (verificadas 2026-10-07):
 * - OpenAI: developers.openai.com/api/docs/pricing (USD por 1M tokens, Standard).
 * - Anthropic: tabla de modelos de la API (USD por 1M tokens).
 * - Serpent: apiserpent.com/docs — Web Default $0.60 / 1K calls (Quick 1 cargo por llamada; Deep 1 por página).
 * Modelos no listados: LLM_PRICE_INPUT / LLM_PRICE_OUTPUT (USD por 1M); si faltan se usa la tarifa más
 * cara conocida del proveedor (conservador para el presupuesto).
 */
type Price = { input: number; cachedInput?: number; output: number };

export const LLM_PRICES: Record<string, Price> = {
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2.0 },
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cachedInput: 0.025, output: 0.4 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, cachedInput: 0.02, output: 1.25 },
  "claude-sonnet-5-5": { input: 2, cachedInput: 0.2, output: 10 },
  "claude-sonnet-5": { input: 2, cachedInput: 0.2, output: 10 },
  "claude-opus-5-5": { input: 4, cachedInput: 0.2, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export function llmPrice(model: string): Price {
  if (LLM_PRICES[model]) return LLM_PRICES[model];
  const base = Object.keys(LLM_PRICES).find((k) => model.startsWith(`${k}-`)); // snapshots con fecha
  if (base) return LLM_PRICES[base];
  const inP = Number(process.env.LLM_PRICE_INPUT), outP = Number(process.env.LLM_PRICE_OUTPUT);
  if (inP > 0 && outP > 0) return { input: inP, output: outP };
  const family = Object.entries(LLM_PRICES).filter(([k]) => (model.startsWith("claude") ? k.startsWith("claude") : k.startsWith("gpt")));
  return family.reduce((a, [, p]) => (p.output > a.output ? p : a), { input: 0, output: 0 });
}

export function llmCost(model: string, inputTokens: number, outputTokens: number, cachedInputTokens = 0) {
  const p = llmPrice(model);
  const fresh = Math.max(0, inputTokens - cachedInputTokens);
  return (fresh * p.input + cachedInputTokens * (p.cachedInput ?? p.input) + outputTokens * p.output) / 1e6;
}

export const SERPENT_USD_PER_CALL = Number(process.env.SERPENT_USD_PER_CALL ?? 0.0006);
