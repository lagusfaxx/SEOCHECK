import { groupTasks, taskGroupKey } from "./task-groups";
import { db } from "./db";
import { gscPeriod } from "./gsc-period";
import { ISSUE_LABELS } from "./audit/issues";
import { ISSUE_WHY, ISSUE_FIX } from "./audit/fixes";
import { kindOf, splitIntentional } from "./audit/insights";
import {
  canAutoResolve,
  issueIdentity,
  observedStatus,
  priorityFor,
  TASK_STATUSES,
  type TaskStatus,
} from "./task-rules";

/** Motivos con que el sistema (no una persona) archiva una tarea: si la incidencia vuelve a ser real, se reabre. */
const INTENTIONAL = "Parece intencional: el informe lo lista en «Revisado, parece intencional».";
const RULES_CHANGED = "Ya no se detecta, pero las reglas de análisis cambiaron desde que se detectó: no se cuenta como corrección.";
const SYSTEM_ARCHIVED = new Set([INTENTIONAL, RULES_CHANGED]);

export async function syncCrawlTasks(crawlId: string) {
  const crawl = await db.crawl.findUniqueOrThrow({ where: { id: crawlId } });
  if (crawl.private || !["completed", "partial"].includes(crawl.status)) return;
  const period = await gscPeriod(crawl.projectId);
  const [issues, pages, traffic] = await Promise.all([
    db.issue.findMany({ where: { crawlId } }),
    db.page.findMany({ where: { crawlId }, omit: { responseHtml: true } }),
    period
      ? db.gscRow.groupBy({
          by: ["page"],
          where: { projectId: crawl.projectId, date: { gte: period.start, lt: period.endExclusive } },
          _sum: { impressions: true },
        })
      : [],
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
  // lo que el informe muestra como intencional (noindex en filtros, canonical que consolida variantes, carrito
  // bloqueado por robots…) no es una tarea: la misma regla para el informe y para la lista de tareas
  const { real } = splitIntentional(issues, pages, { hitLimit: Boolean((crawl.stats as { limitReached?: boolean } | null)?.limitReached) });
  const realIds = new Set(real.map((i) => issueIdentity(i.code, i.url)));
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${crawl.projectId}))`;
      const old = await tx.projectTask.findMany({
        where: { projectId: crawl.projectId, source: "crawl" },
      });
      const prior = new Map(old.map((t) => [t.fingerprint, t]));
      // versión de reglas con que se vio cada tarea por última vez: si cambió, que no aparezca no prueba una corrección
      const lastIds = [...new Set(old.map((t) => t.lastCrawlId).filter((x): x is string => Boolean(x)))];
      const rulesOf = new Map((await tx.crawl.findMany({ where: { id: { in: lastIds } }, select: { id: true, rulesVersion: true } })).map((c) => [c.id, c.rulesVersion]));
      for (const i of new Map(
        real.map((i) => [issueIdentity(i.code, i.url), i]),
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
          ? prev.status === "ignored" && SYSTEM_ARCHIVED.has(prev.resolution ?? "")
            ? "detected"
            : observedStatus(prev.status, prev.lastCrawlId === crawlId)
          : "detected";
        const impr = impressions.get(i.url) ?? 0,
          inlinks = pageMap.get(i.url)?.inlinks ?? 0;
        const data = {
          title: ISSUE_LABELS[i.code] ?? i.code,
          code: i.code,
          url: i.url,
          severity: i.severity,
          category: i.severity === "critical" ? "fix" : "improvement",
          reason: `${ISSUE_WHY[i.code] ?? "Incidencia detectada en la auditoría."}${i.detail ? ` Evidencia (${crawl.startedAt.toISOString().slice(0, 10)}): ${i.detail}.` : ""} ${ISSUE_FIX[i.code] ?? ""} Prioridad: ${impr ? `${impr} impresiones GSC` : `${inlinks} enlaces internos (sin datos GSC)`} × severidad ${i.severity}.`,
          priority: priorityFor(i.severity, impr, inlinks),
          status,
          lastCrawlId: crawlId,
          lastSeenAt: crawl.startedAt,
          resolvedAt: status === "resolved" ? prev?.resolvedAt : null,
          ...(prev && SYSTEM_ARCHIVED.has(prev.resolution ?? "") && status === "detected" ? { resolution: null } : {}),
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
        if (seen.has(t.fingerprint) && !realIds.has(t.fingerprint) && !["resolved", "ignored"].includes(t.status)) {
          // creadas antes de reconocer el caso como intencional: se archivan con el motivo, sin darlas por corregidas
          await tx.projectTask.update({ where: { id: t.id }, data: { status: "ignored", resolution: INTENTIONAL, lastCrawlId: crawlId } });
          await tx.taskEvent.create({
            data: { taskId: t.id, status: "ignored", crawlId, note: "Revisado: parece intencional (ver «Revisado, parece intencional» en el informe)." },
          });
        } else if (
          !seen.has(t.fingerprint) &&
          !["resolved", "ignored"].includes(t.status) &&
          t.lastSeenAt <= crawl.startedAt &&
          canAutoResolve(crawl.status, successful, t.url)
        ) {
          const rulesChanged = Boolean(t.lastCrawlId && rulesOf.get(t.lastCrawlId) !== crawl.rulesVersion);
          await tx.projectTask.update({
            where: { id: t.id },
            data: rulesChanged
              ? { status: "ignored", resolution: RULES_CHANGED, lastCrawlId: crawlId }
              : { status: "resolved", resolvedAt: new Date(), lastCrawlId: crawlId },
          });
          await tx.taskEvent.create({
            data: {
              taskId: t.id,
              status: rulesChanged ? "ignored" : "resolved",
              crawlId,
              note: rulesChanged ? RULES_CHANGED : "La URL se volvió a rastrear correctamente y la incidencia ya no aparece.",
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
  const result = await db.$transaction(async (tx) => {
    const t = await tx.projectTask.findFirstOrThrow({
      where: { projectId, id: taskId },
    });
    const next = await tx.projectTask.update({
      where: { id: t.id },
      data: { status, resolvedAt: status === "resolved" ? new Date() : null },
    });
    if (t.status !== status)
      await tx.taskEvent.create({ data: { taskId, status, actor } });
    return { next, changed: t.status !== status };
  });
  if (result.changed) await import("./pro/notifications").then(n => n.queueNotice(projectId, "task.updated", `task:${result.next.id}:${result.next.updatedAt.toISOString()}`, { message: `${result.next.title}: ${status}`, taskId: result.next.id, status })).catch(e => console.warn("[notifications]", e));
  return result.next;
}
export async function projectActions(projectId: string) {
  // Existing audits also populate tasks after upgrading; preserve manually edited states.
  const latest = await db.crawl.findFirst({ where: { projectId, private: false, status: { in: ["completed", "partial"] } }, orderBy: { startedAt: "desc" }, select: { id: true } });
  if (latest && !(await db.projectTask.findFirst({ where: { projectId, source: "crawl", lastCrawlId: latest.id }, select: { id: true } }))) await syncCrawlTasks(latest.id);
  const rows = await db.projectTask.findMany({
    where: { projectId },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    include: { events: { orderBy: { createdAt: "desc" }, take: 10 } },
  });
  const tracked = await db.trackedKeyword.findMany({ where: { projectId, active: true }, select: { checks: { orderBy: { date: "desc" }, take: 1, select: { url: true, position: true } } } });
  const rankedUrls = new Set(tracked.flatMap(t => t.checks.filter(c => c.url && c.position != null).map(c => c.url!)));
  const period = await gscPeriod(projectId);
  const traffic = period ? await db.gscRow.groupBy({ by: ["page"], where: { projectId, date: { gte: period.start, lt: period.endExclusive } }, _sum: { impressions: true } }) : [];
  // tareas de auditoría con la etiqueta vigente; las que la última auditoría ya no observó quedan marcadas
  // (no se presentan como acciones actuales: su evidencia es de una ejecución anterior)
  // mejoras opcionales (largo de title/meta, alt…): se listan aparte para que no tapen lo que sí hay que corregir
  const optional = (t: { source: string; code: string | null }) => t.source === "crawl" && Boolean(t.code) && kindOf(t.code!) === "opportunity";
  const groups = groupTasks(rows, rankedUrls, new Map(traffic.map(t=>[t.page,t._sum.impressions ?? 0]))).map((g) => ({
    ...g,
    title: g.source === "crawl" && g.code ? ISSUE_LABELS[g.code] ?? g.title : g.title,
    stale: g.source === "crawl" && Boolean(latest) && !g.members.some((m) => m.lastCrawlId === latest!.id),
    optional: optional(g),
  }));
  return {
    tasks: rows.map((t) => ({ ...t, optional: optional(t) })),
    groups,
    latestCrawlId: latest?.id ?? null,
    actions: groups.filter(t => !["resolved", "ignored"].includes(t.status) && !t.stale && !t.optional).slice(0, 5),
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

/**
 * Responsable y fecha límite. El responsable tiene que ser miembro del workspace; con `group` se aplica a todas
 * las URLs del mismo problema y plantilla (como el estado). Avisa por correo al nuevo responsable.
 */
export async function setTaskAssignment(projectId: string, taskId: string, a: { assignee: string | null; dueAt: Date | null }, group: boolean, actor: string) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { workspaceId: true, name: true } });
  const assignee = a.assignee?.trim().toLowerCase() || null;
  if (assignee) {
    const member = await db.membership.findFirst({ where: { workspaceId: p.workspaceId, user: { email: assignee } } });
    if (!member) throw new Error("El responsable tiene que ser miembro del equipo");
  }
  const task = await db.projectTask.findFirstOrThrow({ where: { id: taskId, projectId } });
  const siblings = group && task.source === "crawl" ? (await db.projectTask.findMany({ where: { projectId, source: "crawl", code: task.code } })).filter((t) => taskGroupKey(t) === taskGroupKey(task)) : [task];
  await db.projectTask.updateMany({ where: { id: { in: siblings.map((t) => t.id) } }, data: { assignee, dueAt: a.dueAt } });
  if (assignee && assignee !== task.assignee && assignee !== actor.toLowerCase()) {
    const { mailTemplate, sendMail } = await import("./mail");
    const { appBaseUrl } = await import("./util");
    const { text, html } = mailTemplate(
      `Te asignaron una tarea SEO · ${p.name}`,
      [`${task.title}${siblings.length > 1 ? ` (${siblings.length} URLs)` : ""}.`, a.dueAt ? `Fecha límite: ${a.dueAt.toISOString().slice(0, 10)}.` : "Sin fecha límite.", `Asignada por ${actor}.`],
      appBaseUrl() ? { label: "Ver tarea", url: `${appBaseUrl()}/p/${projectId}/tasks?task=${encodeURIComponent(task.id)}` } : undefined,
      "Recibes este correo porque te asignaron una tarea en FSV Search."
    );
    await sendMail(assignee, `Tarea asignada: ${task.title}`, text, undefined, html).catch(() => "logged");
  }
  return { updated: siblings.length };
}
