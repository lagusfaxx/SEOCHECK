/** Rutas del módulo Correcciones (se montan en /api/p/{id}/…). */
import { db } from "../db";
import { appBaseUrl } from "../util";
import { runInlineJob } from "../inline-job";
import { withQuota, assertPlanActive } from "../plans";
import { llmStatus } from "../providers/llm";
import { LIVE_KINDS } from "./generate";
import { fixHtml, implementationMd, metaCsv, REDIRECT_FORMATS, redirectFile, redirectsOf, robotsTxt, sitemapXml, indexable, type RedirectFormat } from "./files";
import { snippetFor } from "./live";
import { bulkFixes, ensureLive, fileContext, FixError, fixSummary, listFixes, setLive, syncFixes, updateFix } from "./service";
import { improveFixes } from "./ai";
import { notifyCms } from "../cms/service";

/** El plugin de WordPress guarda en caché: se le avisa sin esperar ni fallar si no responde. */
const touch = <T>(projectId: string, r: T) => {
  void notifyCms(projectId).catch(() => {});
  return r;
};

type Ctx = { id: string; url: URL; body: any; user: { id: string; email: string } };
type H = (c: Ctx) => Promise<unknown>;

const download = (body: string, name: string, type: string, asFile: boolean) =>
  new Response(body, { headers: { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store", ...(asFile ? { "content-disposition": `attachment; filename="${name}"` } : {}) } });

/** Las correcciones que entran en un archivo: las aprobadas, o también las propuestas si se pide (?scope=all). */
const forFiles = async (projectId: string, scope: string | null, kinds?: string[]) =>
  db.fix.findMany({ where: { projectId, status: { in: scope === "all" ? ["approved", "proposed"] : ["approved"] }, ...(kinds ? { kind: { in: kinds } } : {}) }, orderBy: [{ url: "asc" }, { kind: "asc" }], take: 20_000 });

export const FIX_GETS: Record<string, H> = {
  fixes: async ({ id, url }) => {
    const q = url.searchParams;
    // primera vez (o crawl nuevo sin correcciones generadas): se arman al abrir la pantalla
    if (!(await db.fix.count({ where: { projectId: id } }))) await syncFixes(id);
    const [list, summary] = await Promise.all([listFixes(id, { status: q.get("status") ?? "proposed", kind: q.get("kind") ?? undefined, q: q.get("q") ?? undefined, take: Number(q.get("take")) || 50, skip: Number(q.get("skip")) || 0 }), fixSummary(id)]);
    return { ...list, rows: list.rows.map((f) => ({ ...f, html: fixHtml(f), live: LIVE_KINDS.has(f.kind) })), summary, ai: llmStatus().available };
  },
  "fixes/summary": async ({ id }) => fixSummary(id),
  /** Qué tareas tienen una corrección escrita: por código de problema y URL (la página o la URL con error). */
  "fixes/for-tasks": async ({ id }) => {
    const rows = await db.fix.findMany({ where: { projectId: id, status: { not: "discarded" }, code: { not: null } }, select: { code: true, url: true, target: true, status: true }, take: 20_000 });
    const out: Record<string, { n: number; status: string }> = {};
    const rank: Record<string, number> = { proposed: 3, approved: 2, verified: 1 };
    const add = (k: string, status: string) => {
      const e = out[k] ?? { n: 0, status };
      e.n++;
      // el estado que se muestra es el que más trabajo pide: propuesta > aprobada > en el sitio
      if ((rank[status] ?? 0) > (rank[e.status] ?? 0)) e.status = status;
      out[k] = e;
    };
    for (const f of rows) {
      if (f.url) add(`${f.code}|${f.url}`, f.status);
      if (f.target && /^https?:/.test(f.target)) add(`${f.code}|${f.target}`, f.status);
      add(`${f.code}|*`, f.status);
    }
    return out;
  },
  "fixes/live": async ({ id, url }) => {
    const live = await ensureLive(id);
    const base = appBaseUrl(url.origin);
    const s = await fixSummary(id);
    return { key: live.key, enabled: live.enabled, snippet: snippetFor(base, live.key), api: `${base}/api/live/${live.key}/page.json?u=/ruta-de-la-pagina`, script: `${base}/api/live/${live.key}/s.js`, installed: s.live?.installed ?? false, lastSeenAt: live.lastSeenAt, lastSeenUrl: live.lastSeenUrl, approvedLive: s.approvedLive, approvedManual: s.approvedManual };
  },
  /** Archivos listos para subir: redirecciones, robots.txt, sitemap.xml, CSV e instrucciones. */
  "fixes/files": async ({ id, url }) => {
    const scope = url.searchParams.get("scope");
    const { pages, crawl, origin } = await fileContext(id);
    const reds = redirectsOf(await forFiles(id, scope, ["redirect"]));
    const text = await forFiles(id, scope, ["title", "meta", "h1"]);
    const all = await db.fix.count({ where: { projectId: id, status: { in: scope === "all" ? ["approved", "proposed"] : ["approved"] } } });
    return {
      crawl: Boolean(crawl), scope: scope === "all" ? "all" : "approved",
      redirects: { count: reds.length, formats: Object.entries(REDIRECT_FORMATS).map(([k, v]) => ({ id: k, label: v.label, file: v.file })) },
      meta: { count: new Set(text.map((f) => f.url)).size },
      sitemap: { count: indexable(pages).length, total: pages.length },
      robots: { current: crawl?.robots ?? null, proposed: crawl ? robotsTxt({ current: crawl.robots, origin, pages }) : null },
      implementation: { count: all },
    };
  },
  "fixes/file": async ({ id, url }) => {
    const q = url.searchParams;
    const name = q.get("name") ?? "";
    const scope = q.get("scope");
    const dl = q.get("download") === "1";
    const { project, pages, crawl, origin } = await fileContext(id);
    if (name === "redirects") {
      const format = (q.get("format") ?? "apache") as RedirectFormat;
      if (!REDIRECT_FORMATS[format]) throw new FixError("Formato desconocido");
      return download(redirectFile(format, redirectsOf(await forFiles(id, scope, ["redirect"]))), REDIRECT_FORMATS[format].file, REDIRECT_FORMATS[format].type, dl);
    }
    if (name === "sitemap") return download(sitemapXml(pages), "sitemap.xml", "application/xml", dl);
    if (name === "robots") return download(robotsTxt({ current: crawl?.robots ?? null, origin, pages }), "robots.txt", "text/plain", dl);
    if (name === "meta") return download(metaCsv(await forFiles(id, scope, ["title", "meta", "h1"])), `titulos-descripciones-${project.domain}.csv`, "text/csv", dl);
    if (name === "implementation") return download(implementationMd({ domain: project.domain, fixes: await forFiles(id, scope) }), `correcciones-${project.domain}.md`, "text/markdown", dl);
    throw new FixError("Archivo desconocido", 404);
  },
};

export const FIX_POSTS: Record<string, H> = {
  /** Regenera las propuestas desde el último análisis (no toca lo ya aprobado, descartado o editado). */
  "fixes/sync": async ({ id }) => syncFixes(id),
  "fixes/bulk": async ({ id, body, user }) => {
    if (body.status === "approved") await assertPlanActive(id);
    return touch(id, await bulkFixes(id, { ids: Array.isArray(body.ids) ? body.ids.map(String) : undefined, kind: body.kind ? String(body.kind) : undefined, from: body.from ? String(body.from) : undefined, status: String(body.status) }, user.email));
  },
  "fixes/improve": async ({ id, body }) => withQuota(id, "ai", () => runInlineJob(id, "fixes.improve", () => improveFixes(id, Array.isArray(body.ids) ? body.ids.map(String).slice(0, 30) : undefined))),
  "fixes/live": async ({ id, body }) => touch(id, await setLive(id, { enabled: typeof body.enabled === "boolean" ? body.enabled : undefined, rotate: body.rotate === true })),
};

export const FIX_PATCHS: Record<string, H> = {
  fixes: async ({ id, body, user }) => {
    if (body.status === "approved") await assertPlanActive(id);
    return touch(id, await updateFix(id, String(body.id ?? ""), { after: body.after, status: body.status }, user.email));
  },
};
