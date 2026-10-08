import { db } from "./db";
import { assertPlanActive } from "./plans";
import { runWithJob } from "./jobctx";
import { releaseBudget } from "./budget";
import { jobDone, jobError } from "./queue";
/** API jobs have the same cost attribution and observable outcomes as queued jobs. */
export async function runInlineJob<T>(
  projectId: string,
  kind: string,
  work: () => Promise<T>,
) {
  await assertPlanActive(projectId);
  const run = await db.jobRun.create({
    data: { projectId, kind, status: "running" },
  });
  try {
    const result = await runWithJob(run.id, work, projectId);
    await jobDone(run.id);
    return result;
  } catch (e) {
    await jobError(run.id, e);
    throw e;
  } finally {
    await releaseBudget(run.id);
  }
}
