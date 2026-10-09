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
};

export type StepResult = { step: string; status: "ok" | "skipped" | "error"; detail?: string };

/**
 * Corre todos los módulos en orden: crawl → GSC → inspección → PageSpeed → keywords → rankings → alertas.
 * Un paso que falla (o no tiene presupuesto/credenciales) se salta y el resto sigue.
 */
export async function runFull(projectId: string, opts: FullRunOpts, jobRunId?: string): Promise<StepResult[]> {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const results: StepResult[] = [];
  const steps = 7;
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

  await step("alerts", "alertas", async () => {
    const a = await computeAlerts(projectId);
    return `${a} alertas`;
  });

  await jobLog("info", "informe completo", results);
  return results;
}
