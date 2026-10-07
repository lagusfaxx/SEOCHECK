import { llmProvider } from "../providers";
import { strip } from "../text";
import { jobLog } from "../jobctx";

export type Intent = "informational" | "commercial" | "transactional" | "navigational";

const RULES: [Intent, RegExp][] = [
  ["transactional", /\b(comprar|compra|precio|precios|barat[oa]s?|oferta|ofertas|descuento|cupon|venta|vender|tienda|cotizar|cotizacion|arriendo|arrendar|delivery|envio|despacho|contratar|reservar|valor|cuanto cuesta|online)\b/],
  ["commercial", /\b(mejor|mejores|top|vs|versus|comparativa|comparar|review|reseña|resena|opiniones|alternativas?|recomendad[oa]s?|ranking|ventajas|tipos de)\b/],
  ["informational", /^(que|como|cual|cuales|cuanto|cuantos|donde|por que|porque|cuando|quien|para que)\b|\b(que es|significado|definicion|guia|tutorial|ejemplos?|pasos|ideas|historia|beneficios|sintomas|causas)\b/],
  ["navigational", /\b(login|iniciar sesion|ingresar|sucursal|sucursales|telefono|horario|contacto|app|www|\.cl|\.com)\b/],
];

export function ruleIntent(term: string, features: string[] = [], brands: string[] = []): Intent | null {
  const t = strip(term);
  if (brands.some((b) => b && t.includes(strip(b)))) return "navigational";
  const hits = RULES.filter(([, re]) => re.test(t)).map(([i]) => i);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) return hits.includes("transactional") ? "transactional" : hits[0];
  if (features.includes("shopping")) return "transactional";
  if (features.includes("local")) return "transactional";
  if (features.includes("paa") && features.includes("snippet")) return "informational";
  return null;
}

/** Clasifica con reglas; los dudosos van al LLM en lotes. */
export async function classifyIntents(items: { term: string; features: string[] }[], brands: string[] = []) {
  const out = new Map<string, Intent>();
  const doubtful: string[] = [];
  for (const it of items) {
    const r = ruleIntent(it.term, it.features, brands);
    if (r) out.set(it.term, r);
    else doubtful.push(it.term);
  }
  const llm = llmProvider();
  if (llm && doubtful.length) {
    for (let i = 0; i < doubtful.length; i += 200) {
      const batch = doubtful.slice(i, i + 200);
      try {
        const res = await llm.json<Record<string, Intent>>(
          "Clasificas la intención de búsqueda de keywords en español (Chile). Valores: informational, commercial, transactional, navigational.",
          `Devuelve un objeto {keyword: intent}.\n${JSON.stringify(batch)}`,
          8000
        );
        for (const [k, v] of Object.entries(res)) if (["informational", "commercial", "transactional", "navigational"].includes(v)) out.set(k, v);
      } catch (e) {
        await jobLog("warn", "intent con LLM falló; esos casos quedan como informational", { error: e instanceof Error ? e.message : String(e), batch: batch.length });
      }
    }
  }
  for (const t of doubtful) if (!out.has(t)) out.set(t, "informational");
  return out;
}
