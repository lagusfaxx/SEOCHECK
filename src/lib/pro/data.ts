import { db } from "../db";
import { requireProject, requireProjectWrite } from "../auth";
import { gscPeriod } from "../gsc-period";
import { normUrl } from "../util";
import { ProError, type ProModule, type ProCtx } from "./types";
import * as a from "./analysis";
import type { Analysis } from "./analysis";

export async function admin(c: ProCtx) {
  await requireProject(c.user.id, c.id, "admin");
}
export const text = (v: unknown, max = 2000) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
export function bounded(v: unknown, fallback: number, max: number) {
  const n = v == null ? fallback : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > max)
    throw new ProError(`Debe ser un entero entre 1 y ${max}`);
  return n;
}
export async function project(id: string) {
  return db.project.findUniqueOrThrow({ where: { id } });
}
export async function lastCrawl(id: string) {
  return db.crawl.findFirst({
    where: {
      projectId: id,
      private: false,
      status: { in: ["completed", "partial"] },
    },
    orderBy: { startedAt: "desc" },
  });
}
/**
 * Páginas del último crawl público. Tras cada crawl todos los módulos se recalculan seguidos: se reutiliza la misma
 * lectura por un minuto en vez de cargar miles de páginas (con sus JSON) una vez por módulo.
 */
const pagesCache = new Map<string, { at: number; pages: Promise<a.Page[]> }>();
export async function pagesOf(id: string) {
  const crawl = await lastCrawl(id);
  if (!crawl) return { crawl, pages: [] as a.Page[] };
  const hit = pagesCache.get(crawl.id);
  if (hit && Date.now() - hit.at < 60_000) return { crawl, pages: await hit.pages };
  for (const [k, v] of pagesCache) if (Date.now() - v.at >= 60_000) pagesCache.delete(k);
  const pages = loadPages(crawl.id);
  pagesCache.set(crawl.id, { at: Date.now(), pages });
  pages.catch(() => pagesCache.delete(crawl.id));
  return { crawl, pages: await pages };
}
async function loadPages(crawlId: string): Promise<a.Page[]> {
  return db.page.findMany({
    where: { crawlId },
    select: {
      id: true,
      crawlId: true,
      url: true,
      finalUrl: true,
      status: true,
      redirects: true,
      clientRedirect: true,
      contentType: true,
      title: true,
      titleLen: true,
      metaDesc: true,
      metaLen: true,
      h1: true,
      canonical: true,
      canonicalType: true,
      noindex: true,
      nofollow: true,
      hreflang: true,
      jsonldTypes: true,
      jsonldErrors: true,
      wordCount: true,
      imgNoAlt: true,
      inlinks: true,
      outlinks: true,
      links: true,
      responseMs: true,
      depth: true,
      contentHash: true,
      inSitemap: true,
      orphan: true,
      blocked: true,
      error: true,
      jsLinks: true,
      rawWordCount: true,
      schemaIssues: true,
      robotsMeta: true,
      xRobots: true,
      fetchError: true,
      headers: true,
      fetchedAt: true,
      renderDiff: true,
      template: true,
      mainHash: true,
      simhash: true,
      extracted: true,
      linkDetails: true,
      structured: true,
      images: true,
      lastmod: true,
      commerce: true,
      responseTruncated: true,
    },
  });
}
export async function traffic(id: string) {
  const period = await gscPeriod(id);
  const rows = period
    ? await db.gscRow.findMany({
        where: {
          projectId: id,
          date: { gte: period.start, lt: period.endExclusive },
        },
      })
    : [];
  return { period, rows };
}
export async function build(kind: string, id: string): Promise<Analysis> {
  const { crawl, pages } = await pagesOf(id);
  const note = !crawl
    ? [
        "Todavía no hay un crawl público terminado. Ejecuta una auditoría para recopilar evidencia.",
      ]
    : [];
  let result: Analysis;
  switch (kind) {
    case "crawl":
      result = a.crawlAnalysis(pages);
      break;
    case "templates":
      result = a.templateAnalysis(pages);
      break;
    case "structure":
      result = a.structuredAnalysis(pages);
      break;
    case "arch":
      result = a.architectureAnalysis(
        pages,
        crawl?.status === "partial" ||
          Boolean(a.json(crawl?.stats).limitReached),
      );
      break;
    case "shop":
      result = a.ecommerceAnalysis(pages);
      break;
    case "index": {
      const [ins, { rows }] = await Promise.all([
        db.urlInspection.findMany({
          where: { projectId: id },
          orderBy: { createdAt: "desc" },
          take: 20000,
        }),
        traffic(id),
      ]);
      result = a.indexationAnalysis(pages, ins, rows);
      const seen = new Set(pages.map((p) => p.url)),
        entries = a.json(crawl?.sitemapAudit).entries ?? [];
      const byUrl = new Map<string, (typeof ins)[number]>(),
        clicks = new Map<string, number>();
      for (const i of ins) if (!byUrl.has(i.url)) byUrl.set(i.url, i);
      const key = (u: string) => normUrl(u) ?? u;
      for (const r of rows)
        clicks.set(key(r.page), (clicks.get(key(r.page)) ?? 0) + r.clicks);
      for (const e of entries)
        if (!seen.has(e.url)) {
          const i = byUrl.get(e.url);
          result.rows.push({
            url: e.url,
            sitemap: true,
            clics: clicks.get(key(e.url)) ?? 0,
            estadoGoogle:
              i?.verdict === "PASS"
                ? "Indexada según inspección"
                : i
                  ? "No confirmada / excluida"
                  : "Desconocido",
            motivo:
              i?.coverageState ??
              "No rastreada: sin evidencia HTTP; inspección pendiente",
            inspeccion: i?.createdAt.toISOString() ?? null,
          });
        }
      if (a.json(crawl?.sitemapAudit).truncated)
        result.notes.push(
          "El sitemap alcanzó un límite de lectura; la matriz no representa todas sus URLs.",
        );
      break;
    }
    case "perf":
      result = a.perfAnalysis(
        pages,
        await db.psiResult.findMany({
          where: { projectId: id },
          orderBy: { createdAt: "desc" },
          take: 1000,
        }),
      );
      break;
    case "serp":
      result = a.serpAnalysis(
        await db.serpSnapshot.findMany({
          where: { projectId: id },
          orderBy: { fetchedAt: "desc" },
          take: 5000,
        }),
      );
      break;
    case "content":
      return contentReport(id);
    case "analytics":
      return analyticsReport(id);
    default:
      throw new ProError("Análisis desconocido", 404);
  }
  return {
    ...result,
    source:
      result.source + (crawl ? ` · crawl del ${crawl.startedAt.toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })}` : ""),
    notes: [...note, ...result.notes],
  };
}
export async function refresh(kind: string, id: string) {
  const report = await build(kind, id),
    crawl = await lastCrawl(id);
  const saved = await db.proSnapshot.create({
    data: {
      projectId: id,
      kind,
      source: { crawlId: crawl?.id ?? null },
      data: JSON.parse(JSON.stringify(report)),
    },
  });
  const old = await db.proSnapshot.findMany({
    where: { projectId: id, kind },
    orderBy: { createdAt: "desc" },
    skip: 60,
    select: { id: true },
  });
  if (old.length)
    await db.proSnapshot.deleteMany({
      where: { projectId: id, id: { in: old.map((s) => s.id) } },
    });
  return { at: saved.createdAt, ...report };
}
export function standard(
  kind: string,
  extra: ProModule["routes"] = {},
): ProModule {
  return {
    prefix: kind,
    routes: {
      GET: {
        "": async ({ id }) => {
          const s = await db.proSnapshot.findFirst({
            where: { projectId: id, kind },
            orderBy: { createdAt: "desc" },
          });
          return s ? { ...a.json(s.data), at: s.createdAt } : build(kind, id);
        },
        ...extra.GET,
      },
      POST: {
        refresh: async (c) => {
          // recalcular no cambia configuración: basta con poder editar (un viewer no puede)
          await requireProjectWrite(c.user.id, c.id);
          return refresh(kind, c.id);
        },
        ...extra.POST,
      },
      PATCH: extra.PATCH,
      DELETE: extra.DELETE,
    },
    afterCrawl: async (_, id) => refresh(kind, id),
    daily: async (id) => refresh(kind, id),
  };
}
export async function analyticsReport(id: string): Promise<Analysis> {
  const { period, rows: gsc } = await traffic(id),
    p = await project(id);
  const ga4 = period
    ? await db.ga4Row.findMany({
        where: {
          projectId: id,
          date: { gte: period.start, lt: period.endExclusive },
        },
      })
    : [];
  const allocation = a.revenueByQuery(gsc, ga4),
    days = period
      ? await db.gscDay.findMany({
          where: {
            projectId: id,
            date: { gte: period.start, lt: period.endExclusive },
          },
          orderBy: { date: "asc" },
        })
      : [];
  const forecast = a.forecast(
    days.map((d) => ({
      date: d.date.toISOString().slice(0, 10),
      clicks: d.clicks,
    })),
  );
  return {
    title: "Ingresos estimados por consulta y pronóstico",
    source: period
      ? `GSC + GA4 · ${period.start.toISOString().slice(0, 10)} a ${period.end.toISOString().slice(0, 10)} · moneda ${a.json(p.settings).ga4?.currency ?? "no informada"}`
      : "Sin datos de Search Console",
    notes: [
      "Ingreso estimado: se reparte el ingreso orgánico de cada landing y día según los clics de sus consultas observadas. Google no entrega ingresos por consulta y excluye consultas anonimizadas; esto no es atribución real.",
      `Ingresos de landings/días sin clics GSC para repartir: ${allocation.unallocated.toFixed(2)}.`,
      ga4.length
        ? "Solo se cruzan las mismas fechas y landings de ambas fuentes."
        : "Sin filas de GA4 para este período: conecta Analytics y sincroniza.",
      forecast
        ? `Proyección a 28 días: ${forecast.next28Days} clics (escenario bajo ${forecast.low}, alto ${forecast.high}). ${forecast.method}`
        : "Pronóstico pendiente: se necesitan 28 días de totales diarios de GSC.",
    ],
    rows: allocation.rows,
  };
}
export async function contentReport(id: string): Promise<Analysis> {
  const [{ pages }, { period, rows }, clusters, tasks] = await Promise.all([
    pagesOf(id),
    traffic(id),
    db.cluster.findMany({
      where: { projectId: id },
      include: { keywords: { select: { term: true, volume: true } } },
      orderBy: { score: "desc" },
      take: 500,
    }),
    db.projectTask.findMany({
      where: { projectId: id, source: "content-calendar" },
      orderBy: { dueAt: "asc" },
      take: 200,
    }),
  ]);
  const prev = period
      ? await db.gscRow.groupBy({
          by: ["page"],
          where: {
            projectId: id,
            date: { gte: period.prevStart, lt: period.start },
          },
          _sum: { clicks: true },
        })
      : [],
    current = new Map<string, number>();
  for (const r of rows)
    current.set(r.page, (current.get(r.page) ?? 0) + r.clicks);
  const out: a.Row[] = clusters.map((c) => ({
    cluster: c.name,
    keyword: c.primary,
    url: c.targetUrl ?? null,
    tipo: "Brief por cluster",
    intencion: c.intent,
    volumen: c.volume,
    consultas: c.keywords
      .map((k) => k.term)
      .slice(0, 20)
      .join(", "),
    secciones:
      "Intención, preguntas, evidencia propia, enlaces internos y verificación",
    clusterId: c.id,
  }));
  for (const p of prev) {
    const before = p._sum.clicks ?? 0,
      after = current.get(p.page) ?? 0;
    if (before >= 20 && after < before * 0.7)
      out.push({
        url: p.page,
        tipo: "Contenido en caída",
        clicsAntes: before,
        clicsAhora: after,
        accion:
          "Revisar intención, competencia y vigencia; la caída no prueba antigüedad",
      });
  }
  for (const p of pages.filter(
    (p) =>
      p.template === "article" &&
      p.lastmod &&
      p.lastmod.getTime() < Date.now() - 365 * 864e5,
  ))
    out.push({
      url: p.url,
      tipo: "Contenido con lastmod antiguo",
      fecha: p.lastmod!.toISOString(),
      accion: "Verificar vigencia; no cambiar fechas sin actualizar contenido",
    });
  for (const t of tasks)
    out.push({
      url: t.url,
      tipo: "Calendario editorial",
      tarea: t.title,
      fecha: t.dueAt?.toISOString() ?? null,
      estado: t.status,
      responsable: t.assignee,
    });
  return {
    title: "Briefs por cluster, vigencia y calendario",
    source: "Clusters + crawl + períodos consecutivos de Search Console",
    notes: [
      "Los briefs por cluster parten de las keywords agrupadas y la URL objetivo; el análisis de contenido existente genera el brief completo con sus controles de evidencia.",
      "La fecha lastmod es una señal declarada por el sitio, no la fecha comprobada de actualización.",
    ],
    rows: out,
  };
}
