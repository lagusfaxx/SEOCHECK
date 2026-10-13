/**
 * Generación de contenido social: captions de Instagram con keywords SEO e imágenes con DALL-E 3.
 */
import { db } from "./db";
import { env } from "./env";
import { fetchT } from "./util";

// ---------- Caption ----------

export async function generateCaption(projectId: string, opts: {
  context?: string;
  keywords?: string[];
  tone?: "profesional" | "cercano" | "inspirador";
}): Promise<string> {
  if (!env.openaiKey && !env.anthropicKey) throw new Error("No hay proveedor LLM configurado (configura OPENAI_API_KEY o ANTHROPIC_API_KEY)");

  const { context = "", keywords = [], tone = "cercano" } = opts;

  // Obtener las keywords top del proyecto si no se pasaron
  let kws = keywords;
  if (!kws.length) {
    const topKws = await db.keyword.findMany({
      where: { projectId, excluded: false },
      orderBy: [{ score: { sort: "desc", nulls: "last" } }, { volume: "desc" }],
      take: 10,
      select: { term: true },
    });
    kws = topKws.map((k) => k.term);
  }

  const toneDesc = { profesional: "profesional y experto", cercano: "cercano, amigable y auténtico", inspirador: "inspirador y motivador" }[tone];

  const systemPrompt = `Eres un experto en redes sociales especializado en Instagram para negocios.
Generas captions efectivos que combinan storytelling con palabras clave SEO de forma natural.
El caption debe: tener entre 150 y 300 caracteres (sin contar hashtags), llamar la atención en la primera línea,
incluir un CTA sutil, y terminar con 5-8 hashtags relevantes separados del texto principal por una línea en blanco.
Tono: ${toneDesc}. Responde SOLO con el caption, sin comillas ni explicaciones.`;

  const userPrompt = `${context ? `Contexto del producto/servicio: ${context}\n\n` : ""}Palabras clave SEO a incluir naturalmente: ${kws.slice(0, 6).join(", ")}

Genera el caption de Instagram.`;

  if (env.openaiKey) {
    const res = await fetchT("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: env.llmModel, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_tokens: 500 }),
      timeoutMs: 30000,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`OpenAI error: ${data.error?.message ?? res.status}`);
    return (data.choices?.[0]?.message?.content ?? "").trim();
  }

  // Anthropic fallback
  const anthropicModel = env.llmProvider === "anthropic" ? env.llmModel : "claude-haiku-5-5";
  const res = await fetchT("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.anthropicKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: anthropicModel, system: systemPrompt, messages: [{ role: "user", content: userPrompt }], max_tokens: 500 }),
    timeoutMs: 30000,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Anthropic error: ${data.error?.message ?? res.status}`);
  return ((data.content?.[0]?.text as string) ?? "").trim();
}

// ---------- Generación de imágenes ----------

export interface GeneratedImage {
  url: string;
  revisedPrompt: string;
}

/**
 * Genera una imagen con DALL-E 3. Devuelve la URL temporal (válida ~1 hora) y el prompt revisado.
 * Tamaño: 1024x1024 (cuadrado, ideal para Instagram).
 */
export async function generateImage(prompt: string): Promise<GeneratedImage> {
  if (!env.openaiKey) throw new Error("Falta OPENAI_API_KEY para generar imágenes");

  const res = await fetchT("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.imageModel,
      prompt,
      n: 1,
      size: "1024x1024",
      quality: "standard",
      response_format: "url",
    }),
    timeoutMs: 60000,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`DALL-E error ${res.status}: ${data.error?.message ?? res.statusText}`);

  const item = data.data?.[0];
  if (!item?.url) throw new Error("DALL-E no devolvió una imagen");

  return { url: item.url as string, revisedPrompt: (item.revised_prompt ?? prompt) as string };
}
