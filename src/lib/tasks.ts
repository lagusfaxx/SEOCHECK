import { groupTasks, taskGroupKey } from "./task-groups";
import { db } from "./db";
import { ISSUE_LABELS } from "./audit/issues";
import { ISSUE_WHY, ISSUE_FIX } from "./audit/fixes";
import {
  canAutoResolve,
  issueIdentity,
  observedStatus,
  priorityFor,
  TASK_STATUSES,
  type TaskStatus,
} from "./task-rules";

export async function syncCrawlTasks(crawlId: string) {
  const crawl = await db.crawl.findUniqueOrThrow({ where: { id: crawlId } });
  if (!["completed", "partial"].includes(crawl.status)) return;
  const [issues, pages, traffic] = await Promise.all([
    db.issue.findMany({ where: { crawlId } }),
    db.page.findMany({ where: { crawlId } }),
    db.gscRow.groupBy({
      by: ["page"],
      where: {
        projectId: crawl.projectId,
        date: { gte: new Date(Date.now() - 30 * 864e5) },
      },
      _sum: { impressions: true },
    }),
  ]);
  const pageMap = new Map(pages.map((p) => [p.url, p]));
  const impressions = new Map(
    traffic.map((r) => [r.page, r._sum.impressions ?? 0]),
  );
  const successful = new Set(
    pages
      .filter((p) => p.status === 200 && !p.error && !p.blocked)
      .map((p) => p.url),
  );
  const seen = new Set(issues.map((i) => issueIdentity(i.code, i.url)));
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${crawl.projectId}))`;
      const old = await tx.projectTask.findMany({
        where: { projectId: crawl.projectId, source: "crawl" },
      });
      const prior = new Map(old.map((t) => [t.fingerprint, t]));
      for (const i of new Map(
        issues.map((i) => [issueIdentity(i.code, i.url), i]),
      ).values()) {
        const fingerprint = issueIdentity(i.code, i.url),
          prev = prior.get(fingerprint);
        // A late older crawl must not reverse the state of a newer observation.
        if (
          prev &&
          prev.lastSeenAt > crawl.startedAt &&
          prev.lastCrawlId !== crawlId
        )
          continue;
        const status = prev
          ? observedStatus(prev.status, prev.lastCrawlId === crawlId)
          : "detected";
        const impr = impressions.get(i.url) ?? 0,
          inlinks = pageMap.get(i.url)?.inlinks ?? 0;
        const data = {
          title: ISSUE_LABELS[i.code] ?? i.code,
          code: i.code,
          url: i.url,
          severity: i.severity,
          category: i.severity === "critical" ? "fix" : "improvement",
          reason: `${ISSUE_WHY[i.code] ?? i.detail ?? "Incidencia detectada en la auditoría."} ${ISSUE_FIX[i.code] ?? ""} Prioridad: ${impr ? `${impr} impresiones GSC` : `${inlinks} enlaces internos (sin datos GSC)`} × severidad ${i.severity}.`,
          priority: priorityFor(i.severity, impr, inlinks),
          status,
          lastCrawlId: crawlId,
          lastSeenAt: crawl.startedAt,
          resolvedAt: status === "resolved" ? prev?.resolvedAt : null,
        };
        if (!prev)
          await tx.projectTask.create({
            data: {
              ...data,
              projectId: crawl.projectId,
              fingerprint,
              source: "crawl",
              events: { create: { status, crawlId } },
            },
          });
        else {
          await tx.projectTask.update({ where: { id: prev.id }, data });
          if (prev.status !== status)
            await tx.taskEvent.create({
              data: { taskId: prev.id, status, crawlId },
            });
        }
      }
      for (const t of old)
        if (
          !seen.has(t.fingerprint) &&
          !["resolved", "ignored"].includes(t.status) &&
          t.lastSeenAt <= crawl.startedAt &&
          canAutoResolve(crawl.status, successful, t.url)
        ) {
          await tx.projectTask.update({
            where: { id: t.id },
            data: {
              status: "resolved",
              resolvedAt: new Date(),
              lastCrawlId: crawlId,
            },
          });
          await tx.taskEvent.create({
            data: {
              taskId: t.id,
              status: "resolved",
              crawlId,
              note: "La URL se volvió a rastrear correctamente y la incidencia ya no aparece.",
            },
          });
        }
    },
    { timeout: 60000 },
  );
}
export async function setTaskStatus(
  projectId: string,
  taskId: string,
  status: TaskStatus,
  actor: string,
) {
  if (!TASK_STATUSES.includes(status))
    throw new Error("Estado de tarea inválido");
  return db.$transaction(async (tx) => {
    const t = await tx.projectTask.findFirstOrThrow({
      where: { projectId, id: taskId },
    });
    const next = await tx.projectTask.update({
      where: { id: t.id },
      data: { status, resolvedAt: status === "resolved" ? new Date() : null },
    });
    if (t.status !== status)
      await tx.taskEvent.create({ data: { taskId, status, actor } });
    return next;
  });
}
export async function projectActions(projectId: string) {
  // Existing audits also populate tasks after upgrading; preserve manually edited states.
  const latest = await db.crawl.findFirst({ where: { projectId, status: { in: ["completed", "partial"] } }, orderBy: { startedAt: "desc" }, select: { id: true } });
  if (latest && !(await db.projectTask.findFirst({ where: { projectId, source: "crawl", lastCrawlId: latest.id }, select: { id: true } }))) await syncCrawlTasks(latest.id);
  const rows = await db.projectTask.findMany({
    where: { projectId },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    include: { events: { orderBy: { createdAt: "desc" }, take: 10 } },
  });
  const tracked = await db.trackedKeyword.findMany({ where: { projectId, active: true }, select: { checks: { orderBy: { date: "desc" }, take: 1, select: { url: true, position: true } } } });
  const rankedUrls = new Set(tracked.flatMap(t => t.checks.filter(c => c.url && c.position != null).map(c => c.url!)));
  const traffic = await db.gscRow.groupBy({ by: ["page"], where: { projectId, date: { gte: new Date(Date.now()-28*864e5) } }, _sum: { impressions: true } });
  const groups = groupTasks(rows, rankedUrls, new Map(traffic.map(t=>[t.page,t._sum.impressions ?? 0])));
  return {
    tasks: rows,
    groups,
    actions: groups.filter(t => !["resolved", "ignored"].includes(t.status)).slice(0, 5),
    improved: groups.filter(t => t.status === "resolved").slice(0, 5),
  };
}

export async function setTaskGroupStatus(
  projectId: string,
  taskId: string,
  status: TaskStatus,
  actor: string,
) {
  if (!TASK_STATUSES.includes(status)) throw new Error("Estado de tarea inválido");
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;
    const task = await tx.projectTask.findFirstOrThrow({ where: { id: taskId, projectId } });
    const candidates = task.source === "crawl" ? await tx.projectTask.findMany({ where: { projectId, source: "crawl", code: task.code } }) : [task];
    const siblings = candidates.filter(t => taskGroupKey(t) === taskGroupKey(task) && t.status !== "resolved");
    for (const t of siblings) {
      if (t.status === status) continue;
      await tx.projectTask.update({ where: { id: t.id }, data: { status, resolvedAt: status === "resolved" ? new Date() : null } });
      await tx.taskEvent.create({ data: { taskId: t.id, status, actor, note: "Estado actualizado para el grupo de incidencias." } });
    }
    return { updated: siblings.length };
  });
}
export async function signalTask(
  projectId: string,
  type: string,
  key: string,
  title: string,
  reason: string,
  priority: number,
  category = "opportunity",
  url?: string | null,
) {
  const fingerprint = JSON.stringify(["signal", type, key]);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;
    const t = await tx.projectTask.findUnique({
      where: { projectId_fingerprint: { projectId, fingerprint } },
    });
    if (!t)
      await tx.projectTask.create({
        data: {
          projectId,
          fingerprint,
          title,
          reason,
          priority,
          category,
          url,
          source: "signal",
          status: "detected",
          events: { create: { status: "detected" } },
        },
      });
    else
      await tx.projectTask.update({
        where: { id: t.id },
        data: { reason, priority, lastSeenAt: new Date() },
      });
  });
}
