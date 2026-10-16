import { crawlLimit } from "./plans";
import { db } from "./db";
import { env } from "./env";
import { jobLog } from "./jobctx";
import { jobProgress } from "./queue";
import { runCrawl } from "./audit/crawler";
import { runInspection, runPsi } from "./audit/extras";
import { syncGsc } from "./rank/gsc";
import { gscAvailable } from "./providers/google";
import { checkRank } from "./rank/rank";
import { computeAlerts } from "./rank/alerts";
import { runKeywordPipeline } from "./keywords/pipeline";
import { assertBudget, BudgetError, est } from "./budget";
import { normTerm } from "./util";
import { backlinksConfigured, runBacklinks } from "./backlinks";
import { ga4Of, syncGa4 } from "./ga4";
import { runAiVisibility, runLocal } from "./ai-local";
import { runKeywordGap } from "./keyword-gap";

export type FullRunOpts = {
  maxPages?: number;
  concurrency?: number;
  render?: boolean;
  gsc?: boolean;
  inspect?: boolean;
  psi?: boolean;
  /** Semillas para el research de keywords; vacío = no corre keywords */
  seeds?: string[];
  rank?: boolean;
  /** Backlinks con la cuenta DataForSEO del servidor (una foto por semana) */
  backlinks?: boolean;
  /** Visibilidad en IA y SEO local (Serpent, una vez por semana) */
  ai?: boolean;
  local?: boolean;
  /** Keywords de la competencia que el sitio no tiene (DataForSEO Labs, una vez al mes) */
  gap?: boolean;
  /** Explicaciones de acciones con IA, si está configurada y habilitada. */
  advice?: boolean;
};

export type StepResult = { step: string; status: "ok" | "skipped" | "error"; detail?: string };

/**
 * Corre todos los módulos en orden: crawl → GSC → inspección → PageSpeed → keywords → rankings → alertas.
 * Un paso que falla (o no tiene presupuesto/credenciales) se salta y el resto sigue.
 */
export async function runFull(projectId: string, opts: FullRunOpts, jobRunId?: string): Promise<StepResult[]> {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const results: StepResult[] = [];
  const steps = 13;
  let n = 0;
  const step = async (name: string, label: string, fn: () => Promise<string | void | null>) => {
    await jobProgress(jobRunId, (n / steps) * 100, label);
    n++;
    try {
      const r = await fn();
      if (r === null) return;
      results.push({ step: name, status: "ok", detail: r || undefined });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ step: name, status: e instanceof BudgetError ? "skipped" : "error", detail: msg.slice(0, 300) });
      await jobLog("warn", `${label}: ${msg}`);
    }
  };
  const skip = (name: string, why: string) => {
    results.push({ step: name, status: "skipped", detail: why });
    return null;
  };

  let crawlId: string | null = null;
  await step("crawl", "crawl", async () => {
    const crawl = await db.crawl.create({
      data: { projectId, options: { maxPages: await crawlLimit(projectId,opts.maxPages ?? 1000), concurrency: opts.concurrency ?? 3, render: Boolean(opts.render) } },
    });
    crawlId = crawl.id;
    try {
      const st = await runCrawl(crawl.id);
      if (st.status === "paused") return `en pausa · ${st.pages} URLs leídas`;
      return `${st.status === "partial" ? "parcial · " : ""}${st.pages} URL${st.pages === 1 ? "" : "s"} · ${st.critical} críticos · ${st.warning} warnings`;
    } catch (e) {
      await db.crawl.updateMany({ where: { id: crawl.id, status: { in: ["queued", "running"] } }, data: { status: "failed", reason: e instanceof Error ? e.message : String(e), finishedAt: new Date() } });
      throw e;
    }
  });

  const gscReady = Boolean(p.gscProperty && (await gscAvailable(projectId)));
  await step("gsc", "Search Console", async () => {
    if (opts.gsc === false) return skip("gsc", "desactivado");
    if (!gscReady) return skip("gsc", p.gscProperty ? "Search Console no está conectado" : "sin propiedad GSC en el proyecto");
    await syncGsc(projectId, 90);
  });

  await step("ga4", "Google Analytics", async () => {
    if (opts.gsc === false) return skip("ga4", "desactivado");
    if (!ga4Of(p.settings).property) return skip("ga4", "sin propiedad de Google Analytics");
    return `${await syncGa4(projectId)} filas`;
  });

  // URLs más enlazadas del crawl: las más importantes del sitio
  const topUrls = async (take: number) =>
    crawlId
      ? (
          await db.page.findMany({
            where: { crawlId, status: 200, noindex: false, error: null, blocked: false },
            orderBy: [{ depth: "asc" }, { inlinks: "desc" }],
            take,
            select: { url: true },
          })
        ).map((x) => x.url)
      : [];

  await step("inspect", "indexación", async () => {
    if (opts.inspect === false) return skip("inspect", "desactivado");
    if (!gscReady) return skip("inspect", "requiere GSC");
    const urls = await topUrls(20);
    if (!urls.length) return skip("inspect", "sin URLs del crawl");
    await runInspection(projectId, urls);
    return `${urls.length} URL${urls.length === 1 ? "" : "s"}`;
  });

  await step("psi", "PageSpeed", async () => {
    if (opts.psi === false) return skip("psi", "desactivado");
    if (!env.psiKey) return skip("psi", "falta PAGESPEED_API_KEY");
    const urls = await topUrls(5);
    if (!urls.length) return skip("psi", "sin URLs del crawl");
    await runPsi(projectId, urls, ["mobile"]);
    return `${urls.length} URL${urls.length === 1 ? "" : "s"} (mobile)`;
  });

  await step("keywords", "keywords", async () => {
    const seeds = (opts.seeds ?? []).map(normTerm).filter(Boolean);
    if (!seeds.length) return skip("keywords", "sin semillas");
    const run = await db.keywordRun.create({ data: { projectId, seeds } });
    try {
      await runKeywordPipeline(run.id);
    } catch (e) {
      await db.keywordRun.update({ where: { id: run.id }, data: { status: "error" } });
      throw e;
    }
    const kws = await db.keyword.count({ where: { runId: run.id } });
    return `${kws} keywords`;
  });

  await step("rank", "rankings", async () => {
    if (opts.rank === false) return skip("rank", "desactivado");
    const tracked = await db.trackedKeyword.findMany({ where: { projectId, active: true }, select: { id: true } });
    if (!tracked.length) return skip("rank", "sin keywords trackeadas");
    await assertBudget({ serpent: est.serpCalls(tracked.length) }, `Rank tracking (${tracked.length} keywords)`);
    let fails = 0;
    for (const t of tracked) await checkRank(t.id).catch(() => fails++);
    if (fails === tracked.length) throw new Error("ningún check de ranking funcionó (revisa SERPENT_API_KEY)");
    return `${tracked.length - fails}/${tracked.length} keywords`;
  });

  await step("backlinks", "backlinks", async () => {
    if (opts.backlinks === false) return skip("backlinks", "desactivado");
    if (!backlinksConfigured()) return skip("backlinks", "no disponible en este servidor");
    const r = await runBacklinks(projectId);
    if ("reused" in r) return "se usa la foto de esta semana";
    if ("skipped" in r) return skip("backlinks", r.skipped!);
    return `${r.competitors?.length ?? 0} competidores${r.errors?.length ? ` · ${r.errors.length} parte(s) sin datos` : ""}`;
  });

  const weekly = (name: string, r: { skipped?: string; reused?: boolean; errors?: string[] } & Record<string, unknown>, ok: string) => {
    if (r.skipped) return skip(name, r.skipped);
    if (r.reused) return "se usa la revisión de esta semana";
    return `${ok}${r.errors?.length ? ` · ${r.errors.length} con error` : ""}`;
  };
  await step("ai", "visibilidad en IA", async () => {
    if (opts.ai === false) return skip("ai", "desactivado");
    const r = await runAiVisibility(projectId);
    return weekly("ai", r, `${(r as any).keywords ?? 0} keywords en 4 IA`);
  });
  await step("local", "SEO local", async () => {
    if (opts.local === false) return skip("local", "desactivado");
    const r = await runLocal(projectId);
    return weekly("local", r, `${(r as any).keywords ?? 0} keywords en Google Maps`);
  });

  await step("gap", "keyword gap", async () => {
    if (opts.gap === false || opts.backlinks === false) return skip("gap", "desactivado");
    const r = await runKeywordGap(projectId);
    if ((r as any).reused) return "se usa la foto de este mes";
    return weekly("gap", r as any, `${(r as any).keywords ?? 0} keywords de ${(r as any).competitors?.length ?? 0} competidores`);
  });

  await step("alerts", "alertas", async () => {
    const a = await computeAlerts(projectId);
    const w = await import("./watch").then((m) => m.runWatch(projectId));
    return `${a} alertas${w.length ? ` · ${w.length} aviso(s) enviado(s)` : ""}`;
  });

  // Las vistas que dependen de GSC/GA4/PageSpeed deben reflejar el final del trabajo, no solo el crawl inicial.
  const { refresh } = await import("./pro/data");
  for (const kind of ["index", "perf", "analytics", "content", "serp"]) await refresh(kind, projectId).catch(e => jobLog("warn", `Actualizar ${kind}: ${e instanceof Error ? e.message : String(e)}`));
  await step("advice", "explicación de próximas acciones", async () => {
    if (opts.advice === false) return skip("advice", "desactivado");
    const result = await (await import("./advice/service")).generateAdvice(projectId);
    if (result.status === "skipped") return skip("advice", result.reason ?? "sin acciones");
    return result.status === "fallback" ? "Se conservan las recomendaciones por reglas: la explicación de IA no se pudo validar" : "Recomendaciones explicadas con evidencia";
  });

  await jobLog("info", "informe completo", results);
  return results;
}
