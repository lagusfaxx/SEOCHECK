import PgBoss from "pg-boss";
import { db } from "./db";

export const QUEUES = {
  keywords: "keywords.run",
  crawl: "audit.crawl",
  psi: "audit.psi",
  inspect: "audit.inspect",
  rankOne: "rank.check",
  rankDaily: "rank.daily",
  gscSync: "gsc.sync",
  gscDaily: "gsc.daily",
  alerts: "alerts.compute",
  content: "content.analyze",
  dfsFlush: "volume.dfs.flush",
  dfsCollect: "volume.dfs.collect",
  full: "report.full",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

const g = globalThis as unknown as { boss?: Promise<PgBoss> };

export function getBoss(): Promise<PgBoss> {
  if (!g.boss) {
    g.boss = (async () => {
      const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: "pgboss" });
      boss.on("error", (e) => console.error("[pg-boss]", e));
      await boss.start();
      for (const q of Object.values(QUEUES)) await boss.createQueue(q).catch(() => {});
      return boss;
    })();
  }
  return g.boss;
}

/** Crea un JobRun visible en la UI y encola el trabajo. */
export async function enqueue(projectId: string, name: QueueName, data: Record<string, unknown>, refId?: string) {
  const run = await db.jobRun.create({ data: { projectId, kind: name, refId } });
  const boss = await getBoss();
  await boss.send(name, { ...data, projectId, jobRunId: run.id }, { retryLimit: 1, expireInHours: 6 });
  return run;
}

export async function jobProgress(id: string | undefined, progress: number, message?: string) {
  if (!id) return;
  await db.jobRun.update({ where: { id }, data: { status: "running", progress: Math.round(progress), message } }).catch(() => {});
}

export async function jobDone(id: string | undefined, message?: string) {
  if (!id) return;
  await db.jobRun.update({ where: { id }, data: { status: "done", progress: 100, message } }).catch(() => {});
}

export async function jobError(id: string | undefined, err: unknown) {
  if (!id) return;
  const message = err instanceof Error ? err.message : String(err);
  await db.jobRun.update({ where: { id }, data: { status: "error", message: message.slice(0, 500) } }).catch(() => {});
}
