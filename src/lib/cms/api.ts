/** Rutas de la conexión con el CMS y de los artículos (se montan en /api/p/{id}/…). */
import { db } from "../db";
import { appBaseUrl } from "../util";
import { enqueue, QUEUES } from "../queue";
import { assertPlanActive, consumeQuota, refundQuota } from "../plans";
import { llmStatus } from "../providers/llm";
import { CmsError, SHOPIFY_SCOPES } from "./client";
import { zipStore } from "./zip";

const PLUGIN_README = `=== FSV Search ===\nStable tag: 1.0.0\nLicense: GPLv2 or later\n\nAplica en el servidor las correcciones SEO aprobadas en FSV Search y recibe artículos como borrador.\nEste plugin es exclusivo del sitio para el que se descargó: contiene su clave de conexión.\n`;
import { checkCms, cmsStatus, connectShopify, connectWordpress, disconnectCms, pluginFile, pushShopify, sendDraft } from "./service";
import { sanitizeArticle, slugify, wordCount } from "../articles/write";
import { ownEvidence, type ContentResult } from "../content/analyze";

type Ctx = { id: string; url: URL; body: any; user: { id: string; email: string } };
type H = (c: Ctx) => Promise<unknown>;

const articleOf = async (projectId: string, aid: unknown) => {
  const a = typeof aid === "string" ? await db.article.findFirst({ where: { id: aid, projectId } }) : null;
  if (!a) throw new CmsError("El artículo no existe", 404);
  return a;
};
const LIST = { id: true, keyword: true, status: true, title: true, words: true, warnings: true, error: true, published: true, contentId: true, createdAt: true, updatedAt: true } as const;

const htmlDoc = (a: { title: string; meta: string; html: string }) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${a.title.replace(/</g, "&lt;")}</title><meta name="description" content="${a.meta.replace(/"/g, "&quot;")}"></head>
<body><article><h1>${a.title.replace(/</g, "&lt;")}</h1>
${a.html}
</article></body></html>
`;

/** HTML del artículo a Markdown simple (encabezados, párrafos, listas, negritas y links). */
export function toMarkdown(html: string): string {
  return html
    .replace(/<h2>(.*?)<\/h2>/gis, "\n## $1\n")
    .replace(/<h3>(.*?)<\/h3>/gis, "\n### $1\n")
    .replace(/<h4>(.*?)<\/h4>/gis, "\n#### $1\n")
    .replace(/<li>(.*?)<\/li>/gis, "- $1\n")
    .replace(/<\/?(ul|ol)>/gi, "\n")
    .replace(/<(strong|b)>(.*?)<\/\1>/gis, "**$2**")
    .replace(/<(em|i)>(.*?)<\/\1>/gis, "_$2_")
    .replace(/<a href="([^"]*)">(.*?)<\/a>/gis, "[$2]($1)")
    .replace(/<p>(.*?)<\/p>/gis, "\n$1\n")
    .replace(/<br\s*\/?>/gi, "  \n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";
}

export const CMS_GETS: Record<string, H> = {
  cms: async ({ id }) => ({ connection: await cmsStatus(id), shopifyScopes: SHOPIFY_SCOPES }),
  "cms/plugin": async ({ id, url }) => {
    const php = await pluginFile(id, url.origin);
    // WordPress instala plugins subidos como .zip con una carpeta adentro
    const zip = zipStore([{ name: "fsv-search/fsv-search.php", data: php }, { name: "fsv-search/readme.txt", data: PLUGIN_README }]);
    return new Response(new Uint8Array(zip), { headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="fsv-search.zip"', "cache-control": "no-store" } });
  },
  articles: async ({ id }) => ({ rows: await db.article.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, select: LIST, take: 200 }), ai: llmStatus().available, cms: await cmsStatus(id) }),
  "articles/one": async ({ id, url }) => articleOf(id, url.searchParams.get("aid")),
  "articles/download": async ({ id, url }) => {
    const a = await articleOf(id, url.searchParams.get("aid"));
    const md = url.searchParams.get("format") === "md";
    const body = md ? `# ${a.title}\n\n> ${a.meta}\n\n${toMarkdown(a.html)}` : htmlDoc(a);
    return new Response(body, { headers: { "content-type": `${md ? "text/markdown" : "text/html"}; charset=utf-8`, "content-disposition": `attachment; filename="${a.slug || "articulo"}.${md ? "md" : "html"}"`, "cache-control": "no-store" } });
  },
};

export const CMS_POSTS: Record<string, H> = {
  "cms/wordpress": async ({ id, body }) => {
    await connectWordpress(id, String(body.url ?? ""));
    // si el plugin ya estaba instalado (reconexión), queda conectado al tiro
    return checkCms(id).catch(() => cmsStatus(id));
  },
  "cms/shopify": async ({ id, body }) => {
    await connectShopify(id, String(body.shop ?? ""), String(body.token ?? ""));
    return cmsStatus(id);
  },
  "cms/check": async ({ id }) => checkCms(id),
  "cms/push": async ({ id }) => {
    await assertPlanActive(id);
    return pushShopify(id);
  },
  /** Escribe un artículo completo desde un análisis de contenido. */
  articles: async ({ id, body }) => {
    if (!llmStatus().available) throw new CmsError("La redacción con IA no está habilitada en este servidor", 503);
    const content = typeof body.cid === "string" ? await db.contentAnalysis.findFirst({ where: { id: body.cid, projectId: id } }) : null;
    if (!content) throw new CmsError("El análisis de contenido no existe", 404);
    if (content.status !== "done") throw new CmsError("Espera a que termine el análisis de contenido");
    const busy = await db.article.findFirst({ where: { projectId: id, contentId: content.id, status: { in: ["queued", "writing"] } }, select: { id: true } });
    if (busy) throw new CmsError("Ya se está escribiendo un artículo para este análisis", 409);
    await assertPlanActive(id);
    const ws = await consumeQuota(id, "briefs", 1);
    try {
      const a = await db.article.create({ data: { projectId: id, contentId: content.id, keyword: content.keyword, title: content.keyword } });
      await enqueue(id, QUEUES.article, { articleId: a.id }, a.id);
      return a;
    } catch (e) {
      await refundQuota(ws, "briefs", 1).catch(() => {});
      throw e;
    }
  },
  "articles/publish": async ({ id, body }) => {
    const a = await articleOf(id, body.aid);
    if (a.status !== "done") throw new CmsError("El artículo aún no está listo");
    const prev = (a.published ?? null) as { kind?: string; id?: string } | null;
    const r = await sendDraft(id, { title: a.title, html: a.html, meta: a.meta, slug: a.slug, previousId: prev?.kind === "wordpress" ? prev.id : null });
    return db.article.update({ where: { id: a.id }, data: { published: { ...r, at: new Date().toISOString() } } });
  },
};

export const CMS_PATCHS: Record<string, H> = {
  articles: async ({ id, body }) => {
    const a = await articleOf(id, body.aid);
    if (a.status !== "done") throw new CmsError("El artículo aún no está listo");
    const data: Record<string, unknown> = { edited: true };
    if (body.title != null) data.title = String(body.title).replace(/\s+/g, " ").trim().slice(0, 120);
    if (body.meta != null) data.meta = String(body.meta).replace(/\s+/g, " ").trim().slice(0, 320);
    if (body.slug != null) data.slug = slugify(String(body.slug));
    if (body.html != null) {
      if (String(body.html).length > 300_000) throw new CmsError("El artículo es demasiado largo");
      const content = a.contentId ? await db.contentAnalysis.findUnique({ where: { id: a.contentId } }) : null;
      const r = (content?.result ?? {}) as unknown as ContentResult;
      // lo que escribe la persona es suyo: se limpia el HTML y los links, pero no se le quitan frases
      const clean = sanitizeArticle(String(body.html), { knownUrls: r.knownUrls ?? [], base: r.url ?? `https://x.invalid/`, source: r.mine ? ownEvidence(r) : "", strictClaims: false });
      data.html = clean.html;
      data.words = wordCount(clean.html);
      data.warnings = clean.warnings;
    }
    if (data.title === "") throw new CmsError("El título no puede quedar vacío");
    return db.article.update({ where: { id: a.id }, data });
  },
};

export const CMS_DELETES: Record<string, H> = {
  cms: async ({ id }) => disconnectCms(id),
  articles: async ({ id, body, url }) => {
    const a = await articleOf(id, body.aid ?? url.searchParams.get("aid"));
    return db.article.delete({ where: { id: a.id } });
  },
};

export const pluginUrl = (origin: string, projectId: string) => `${appBaseUrl(origin)}/api/p/${projectId}/cms/plugin`;
