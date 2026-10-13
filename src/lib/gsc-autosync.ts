import { db } from "./db";
import { enqueue, QUEUES } from "./queue";
import { gscAvailable } from "./providers/google";

/** Primera sincronización (90 días) apenas hay conexión y propiedad; después la mantiene el cron diario. */
export async function autoSyncGsc(projectId: string) {
  const p = await db.project.findUnique({ where: { id: projectId }, select: { gscProperty: true } });
  if (!p?.gscProperty || !(await gscAvailable(projectId))) return null;
  const busy = await db.jobRun.findFirst({ where: { projectId, kind: QUEUES.gscSync, status: { in: ["queued", "running"] } }, select: { id: true } });
  if (busy) return null;
  return enqueue(projectId, QUEUES.gscSync, { backfillDays: 90 });
}
