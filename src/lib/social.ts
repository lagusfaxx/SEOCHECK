/**
 * Contenido social: captions de Instagram con keywords SEO, imágenes con OpenAI y publicación (inmediata o programada).
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

// ---------- Imágenes ----------

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Imágenes propias: se guardan en la base y se sirven públicas en /api/social/image/{id} (Instagram solo acepta JPEG). */
export async function saveImage(projectId: string, data: Buffer): Promise<string> {
  if (data.length > MAX_IMAGE_BYTES) throw new Error("La imagen supera 8 MB");
  if (!(data[0] === 0xff && data[1] === 0xd8)) throw new Error("La imagen debe ser JPEG");
  const img = await db.socialImage.create({ data: { projectId, mime: "image/jpeg", data }, select: { id: true } });
  return `/api/social/image/${img.id}`;
}

/** data:image/jpeg;base64,... → Buffer */
export function decodeDataUrl(v: unknown): Buffer {
  const m = typeof v === "string" ? /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(v) : null;
  if (!m) throw new Error("Imagen inválida: se espera JPEG");
  return Buffer.from(m[1], "base64");
}

/**
 * Genera una imagen cuadrada en JPEG con OpenAI (gpt-image). Con `reference` (foto del producto) usa el endpoint
 * de edición para que el producto real aparezca en la escena.
 */
export async function generateImage(projectId: string, prompt: string, reference?: Buffer): Promise<{ url: string }> {
  if (!env.openaiKey) throw new Error("Falta OPENAI_API_KEY para generar imágenes");
  // dall-e no entrega JPEG ni acepta imagen de referencia
  const model = env.imageModel.startsWith("dall-e") ? "gpt-image-1" : env.imageModel;
  const common = { model, prompt, size: "1024x1024", quality: "medium", output_format: "jpeg" };

  let res: Response;
  if (reference) {
    const form = new FormData();
    for (const [k, v] of Object.entries(common)) form.append(k, v);
    form.append("image[]", new Blob([new Uint8Array(reference)], { type: "image/jpeg" }), "referencia.jpg");
    res = await fetchT("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.openaiKey}` },
      body: form,
      timeoutMs: 180_000,
    });
  } else {
    res = await fetchT("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(common),
      timeoutMs: 180_000,
    });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI imágenes (${res.status}): ${data.error?.message ?? res.statusText}`);
  const b64: string | undefined = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI no devolvió una imagen");
  return { url: await saveImage(projectId, Buffer.from(b64, "base64")) };
}

// ---------- Publicación ----------

/**
 * Publica un post. El cambio a "publishing" es atómico: un doble clic o el worker en paralelo no lo publican dos veces.
 * Devuelve false si otro proceso ya lo tomó.
 */
export async function publishPost(postId: string, from: string[]): Promise<boolean> {
  const claimed = await db.socialPost.updateMany({ where: { id: postId, status: { in: from } }, data: { status: "publishing", errorMsg: null } });
  if (!claimed.count) return false;
  const post = await db.socialPost.findUniqueOrThrow({ where: { id: postId } });
  const { publishNow } = await import("./providers/meta");
  try {
    if (!post.imageUrl) throw new Error("El post no tiene imagen");
    const { postId: metaPostId } = await publishNow(post.projectId, post.imageUrl, post.caption);
    await db.socialPost.update({ where: { id: postId }, data: { status: "published", metaPostId, publishedAt: new Date() } });
    return true;
  } catch (e) {
    await db.socialPost.update({ where: { id: postId }, data: { status: "failed", errorMsg: (e instanceof Error ? e.message : String(e)).slice(0, 500) } });
    throw e;
  }
}

/** Worker (cada minuto): publica los programados que ya vencieron y libera los que quedaron colgados por un reinicio. */
export async function publishDue() {
  await db.socialPost.updateMany({
    where: { status: "publishing", updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
    data: { status: "failed", errorMsg: "La publicación se interrumpió: revisa en Instagram si salió antes de reintentar" },
  });
  const due = await db.socialPost.findMany({ where: { status: "scheduled", scheduledAt: { lte: new Date() } }, select: { id: true }, orderBy: { scheduledAt: "asc" }, take: 20 });
  let published = 0;
  for (const p of due) {
    try {
      if (await publishPost(p.id, ["scheduled"])) published++;
    } catch (e) {
      console.error("[social] programado", p.id, e);
    }
  }
  return { due: due.length, published };
}
