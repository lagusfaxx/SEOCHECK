import { db } from "../db";
import { standard, admin, project, lastCrawl } from "./data";
import { ProError } from "./types";
import { extractCustom } from "../audit/parse/extract";
import { classifyTemplate } from "../audit/parse/template";
import { load } from "cheerio";
export const module = standard("crawl", {
  GET: {
    // solo la configuración del crawler: el resto de settings (feed, GA4, avisos…) no es para cualquier miembro
    settings: async ({ id }) => {
      const { auth: _auth, ...crawler } = ((await project(id)).settings as any)?.crawler ?? {};
      return { crawler };
    },
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
      const allowed = [
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
