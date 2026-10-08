import type PgBoss from "pg-boss";
import { db } from "../lib/db";
import { env } from "../lib/env";
import { enqueue, getBoss, jobDone, jobError, jobProgress, QUEUES, type QueueName } from "../lib/queue";
import { runKeywordPipeline } from "../lib/keywords/pipeline";
import { runCrawl } from "../lib/audit/crawler";
import { runInspection, runPsi } from "../lib/audit/extras";
import { checkRank, dueTracked } from "../lib/rank/rank";
import { syncGsc } from "../lib/rank/gsc";
import { computeAlerts } from "../lib/rank/alerts";
import { analyzeContent } from "../lib/content/analyze";
import { runWithJob } from "../lib/jobctx";
import { assertBudget, BudgetError, est } from "../lib/budget";
import { collectDfsQueue, flushDfsQueue } from "../lib/volume/dataforseo";
import { backfillVolumes, writeCache } from "../lib/volume/broker";
import { runFull } from "../lib/fullrun";

type Data = { projectId: string; jobRunId?: string; [k: string]: any };

async function handle(boss: PgBoss, name: QueueName, d: Data) {
  switch (name) {
    case QUEUES.keywords:
      return runKeywordPipeline(d.runId, d.jobRunId);
    case QUEUES.crawl:
      return runCrawl(d.crawlId, d.jobRunId).catch(async (e) => {
        await db.crawl.update({ where: { id: d.crawlId }, data: { status: "error" } });
        throw e;
      });
    case QUEUES.psi:
      return runPsi(d.projectId, d.urls, d.strategies);
    case QUEUES.inspect:
      return runInspection(d.projectId, d.urls);
    case QUEUES.rankOne: {
      const ids: string[] = d.trackedIds ?? [d.trackedId];
      await assertBudget({ serpent: est.serpCalls(ids.length) }, `Rank tracking (${ids.length} keywords)`);
      for (let i = 0; i < ids.length; i++) {
        try {
          await checkRank(ids[i]);
        } catch (e) {
          console.error("[rank]", ids[i], e);
        }
        await jobProgress(d.jobRunId, ((i + 1) / ids.length) * 95, `${i + 1}/${ids.length}`);
      }
      await computeAlerts(d.projectId);
      return;
    }
    case QUEUES.rankDaily: {
      const due = await dueTracked();
      const byProject = new Map<string, string[]>();
      for (const t of due) byProject.set(t.projectId, [...(byProject.get(t.projectId) ?? []), t.id]);
      // con JobRun: si el presupuesto no alcanza, el error queda visible en la UI del proyecto
      for (const [projectId, trackedIds] of byProject) await enqueue(projectId, QUEUES.rankOne, { trackedIds });
      return;
    }
    case QUEUES.gscSync:
      await syncGsc(d.projectId, d.backfillDays ?? 90, (pct) => jobProgress(d.jobRunId, pct * 0.9));
      await computeAlerts(d.projectId);
      return;
    case QUEUES.gscDaily: {
      const projects = await db.project.findMany({ where: { gscProperty: { not: null } } });
      for (const p of projects) await boss.send(QUEUES.gscSync, { projectId: p.id });
      return;
    }
    case QUEUES.alerts:
      return computeAlerts(d.projectId);
    case QUEUES.dfsFlush: {
      const tasks = await flushDfsQueue();
      if (tasks) await boss.send(QUEUES.dfsCollect, {}, { singletonKey: "dfs-collect", startAfter: 15 });
      return { tasks };
    }
    case QUEUES.dfsCollect: {
      const r = await collectDfsQueue((rows, country, language) => writeCache(rows, country, language, "dataforseo"));
      let updated = 0;
      for (const t of r.touched) updated += await backfillVolumes(t.country, t.language, t.keywords);
      // quedan tasks en cola: volver a revisar
      if (r.waiting) await boss.send(QUEUES.dfsCollect, {}, { singletonKey: "dfs-collect", startAfter: 20 });
      return { done: r.done, waiting: r.waiting, updated };
    }
    case QUEUES.full: {
      const steps = await runFull(d.projectId, d.opts ?? {}, d.jobRunId);
      return steps.map((s) => `${s.step}:${s.status}`).join(" ");
    }
    case QUEUES.content:
      await assertBudget({ serpent: est.serpCalls(1), llm: est.llmBrief() }, "Optimización de contenido");
      return analyzeContent(d.contentId, d.jobRunId).catch(async (e) => {
        await db.contentAnalysis.update({ where: { id: d.contentId }, data: { status: "error" } });
        throw e;
      });
  }
}

const CONCURRENCY: Partial<Record<QueueName, number>> = {
  [QUEUES.crawl]: 2,
  [QUEUES.keywords]: 2,
  [QUEUES.content]: 3,
  [QUEUES.rankOne]: 2,
};

async function main() {
  const boss = await getBoss();
  for (const name of Object.values(QUEUES)) {
    const n = CONCURRENCY[name] ?? 1;
    for (let i = 0; i < n; i++) {
      await boss.work<Data>(name, { pollingIntervalSeconds: 2 }, async (jobs) => {
        for (const job of jobs) {
          const d = job.data;
          console.log(`[${name}] start ${job.id}`);
          try {
            await jobProgress(d.jobRunId, 1);
            const r = await runWithJob(d.jobRunId, () => handle(boss, name, d), d.projectId);
            await jobDone(d.jobRunId, r && typeof r === "object" ? JSON.stringify(r).slice(0, 300) : undefined);
            console.log(`[${name}] done ${job.id}`);
          } catch (e) {
            console.error(`[${name}] error ${job.id}`, e);
            await jobError(d.jobRunId, e);
            if (e instanceof BudgetError) continue; // no reintentar: no se gastó nada y fallaría igual
            throw e;
          }
        }
      });
    }
  }
  const rankCron = process.env.RANK_CRON ?? "0 6 * * *";
  const gscCron = process.env.GSC_CRON ?? "0 7 * * *";
  await boss.schedule(QUEUES.rankDaily, rankCron, {}, { tz: env.tz });
  await boss.schedule(QUEUES.gscDaily, gscCron, {}, { tz: env.tz });
  console.log("worker listo");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    const boss = await getBoss();
    await boss.stop({ graceful: true, timeout: 20000 }).catch(() => {});
    process.exit(0);
  });
}
