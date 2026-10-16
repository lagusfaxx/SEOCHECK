import { db } from "../db";
import { standard, admin, project, lastCrawl, text } from "./data";
import { ProError } from "./types";
import { extractCustom } from "../audit/parse/extract";
import { classifyTemplate } from "../audit/parse/template";
import { load } from "cheerio";
import { enqueue, QUEUES } from "../queue";
import { crawlLimit } from "../plans";
import { requireProjectWrite } from "../auth";
import { encrypt } from "../gsc-oauth";
import { normUrl } from "../util";
import { pathMatches } from "../audit/crawler";

/** Crawl del proyecto (de este proyecto, no de otro). */
async function ownCrawl(projectId: string, crawlId: unknown) {
  const c = typeof crawlId === "string" ? await db.crawl.findFirst({ where: { id: crawlId, projectId } }) : null;
  if (!c) throw new ProError("Crawl no encontrado", 404);
  return c;
}
async function assertNoCrawlRunning(projectId: string) {
  const busy = await db.jobRun.findFirst({ where: { projectId, kind: QUEUES.crawl, status: { in: ["queued", "running"] } }, select: { id: true } });
  if (busy) throw new ProError("Ya hay un crawl en curso: espera a que termine, páusalo o cancélalo", 409);
}
export const module = standard("crawl", {
  GET: {
    // solo la configuración del crawler: el resto de settings (feed, GA4, avisos…) no es para cualquier miembro
    settings: async ({ id }) => {
      const { auth: _auth, ...crawler } = ((await project(id)).settings as any)?.crawler ?? {};
      return { crawler };
    },
    // ejecuciones con estado, para pausar/reanudar y saber de qué crawl sale cada cifra
    runs: async ({ id }) =>
      (
        await db.crawl.findMany({
          where: { projectId: id },
          orderBy: { startedAt: "desc" },
          take: 20,
          select: { id: true, status: true, reason: true, private: true, rulesVersion: true, startedAt: true, finishedAt: true, stats: true, options: true },
        })
      ).map((c) => ({
        id: c.id,
        status: c.status,
        reason: c.reason,
        private: c.private,
        rulesVersion: c.rulesVersion,
        startedAt: c.startedAt,
        finishedAt: c.finishedAt,
        pages: (c.stats as any)?.pages ?? null,
        startUrl: (c.options as any)?.startUrl ?? null,
      })),
    evidence: async ({ id, url }) => {
      const crawl = await lastCrawl(id);
      if (!crawl) throw new ProError("Sin crawl", 404);
      const p = await db.page.findFirst({
        where: { crawlId: crawl.id, url: url.searchParams.get("url") ?? "" },
        select: {
          url: true,
          status: true,
          finalUrl: true,
          redirects: true,
          headers: true,
          responseHtml: true,
          responseTruncated: true,
          robotsMeta: true,
          xRobots: true,
          fetchedAt: true,
          extracted: true,
        },
      });
      if (!p) throw new ProError("URL no encontrada", 404);
      return p;
    },
  },
  POST: {
    // la pausa la aplica el crawl entre URLs: guarda lo leído y la cola, y queda «paused»
    pause: async (c) => {
      await requireProjectWrite(c.user.id, c.id);
      const crawl = await ownCrawl(c.id, c.body.crawlId);
      if (!["queued", "running"].includes(crawl.status)) throw new ProError("Solo se puede pausar un crawl en curso");
      await db.crawl.update({ where: { id: crawl.id }, data: { status: "pausing" } });
      return { ok: true };
    },
    resume: async (c) => {
      await requireProjectWrite(c.user.id, c.id);
      const crawl = await ownCrawl(c.id, c.body.crawlId);
      if (crawl.status !== "paused") throw new ProError("El crawl no está en pausa");
      await assertNoCrawlRunning(c.id);
      await db.crawl.update({ where: { id: crawl.id }, data: { status: "queued", reason: null } });
      await enqueue(c.id, QUEUES.crawl, { crawlId: crawl.id }, crawl.id);
      return { ok: true };
    },
    // auditoría autenticada de staging: credenciales cifradas, fuera de informes, tareas y avisos
    private: async (c) => {
      await admin(c);
      await assertNoCrawlRunning(c.id);
      const start = normUrl(text(c.body.startUrl, 2000));
      if (!start) throw new ProError("URL de inicio inválida (http o https)");
      const auth = {
        user: text(c.body.user, 200) || undefined,
        pass: typeof c.body.pass === "string" ? c.body.pass.slice(0, 500) : undefined,
        cookie: text(c.body.cookie, 4000) || undefined,
      };
      const hasAuth = Boolean(auth.user || auth.pass || auth.cookie);
      const crawl = await db.crawl.create({
        data: {
          projectId: c.id,
          private: true,
          options: {
            startUrl: start,
            maxPages: await crawlLimit(c.id, Number(c.body.maxPages ?? 200) || 200),
            render: c.body.render === true,
            ...(hasAuth ? { auth: encrypt(JSON.stringify(auth)) } : {}),
          },
        },
      });
      await enqueue(c.id, QUEUES.crawl, { crawlId: crawl.id }, crawl.id);
      return { id: crawl.id, private: true };
    },
  },
  PATCH: {
    settings: async (c) => {
      await admin(c);
      const p = await project(c.id),
        b = c.body;
      if (
        b.userAgent != null &&
        (typeof b.userAgent !== "string" ||
          b.userAgent.length > 300 ||
          /[\r\n]/.test(b.userAgent))
      )
        throw new ProError("User-agent inválido");
      for (const [key, max] of [
        ["maxPerPattern", 1000],
        ["maxDepth", 50],
        ["maxPages", 10000],
        ["concurrency", 10],
      ] as const)
        if (
          b[key] != null &&
          (!Number.isInteger(b[key]) || b[key] < (key === "maxPages" || key === "concurrency" ? 1 : 0) || b[key] > max)
        )
          throw new ProError(`${key} fuera de rango`);
      if (
        b.ignoreParams != null &&
        (!Array.isArray(b.ignoreParams) ||
          b.ignoreParams.length > 50 ||
          b.ignoreParams.some(
            (v: unknown) => typeof v !== "string" || v.length > 80,
          ))
      )
        throw new ProError("Parámetros inválidos");
      if (b.extract != null) {
        if (!Array.isArray(b.extract) || b.extract.length > 20)
          throw new ProError("Máximo 20 reglas");
        try {
          extractCustom("<html></html>", load(""), b.extract);
        } catch (e) {
          throw new ProError(
            e instanceof Error ? e.message : "Extracción inválida",
          );
        }
      }
      if (b.templates != null) {
        if (
          !Array.isArray(b.templates) ||
          b.templates.length > 30 ||
          b.templates.some(
            (r: any) =>
              typeof r.name !== "string" ||
              typeof r.pattern !== "string" ||
              r.pattern.length > 200,
          )
        )
          throw new ProError("Reglas de plantilla inválidas");
        classifyTemplate(
          {
            url: `https://${p.domain}/`,
            signals: {
              linkGroup: 0,
              article: false,
              time: false,
              cart: false,
              price: false,
            },
            jsonldTypes: [],
            h1: [],
            title: null,
          },
          b.templates,
        );
      }
      if (b.render != null && typeof b.render !== "boolean") throw new ProError("render debe ser sí o no");
      if (
        b.renderPaths != null &&
        (!Array.isArray(b.renderPaths) || b.renderPaths.length > 30 || b.renderPaths.some((v: unknown) => typeof v !== "string" || !v.startsWith("/") && v !== "*" || v.length > 200))
      )
        throw new ProError("Rutas a renderizar: hasta 30, cada una empieza con / (ej. /productos/*)");
      if (b.renderPaths) pathMatches(`https://${p.domain}/`, b.renderPaths);
      const allowed = [
          "render",
          "renderPaths",
          "userAgent",
          "maxPerPattern",
          "maxDepth",
          "maxPages",
          "concurrency",
          "ignoreParams",
          "extract",
          "templates",
        ],
        settings = p.settings as any;
      return db.project.update({
        where: { id: c.id },
        data: {
          settings: {
            ...settings,
            crawler: {
              ...settings.crawler,
              ...Object.fromEntries(
                allowed.filter((k) => k in b).map((k) => [k, b[k]]),
              ),
            },
          },
        },
        select: { id: true, settings: true },
      });
    },
  },
});
