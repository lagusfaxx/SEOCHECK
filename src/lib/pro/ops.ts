import { randomBytes } from "node:crypto";
import { db } from "../db";
import { admin, text, project } from "./data";
import { ProError, type ProModule } from "./types";
import { env } from "../env";
import { queueNotice } from "./notifications";
import { assertUrlAllowed } from "../net/ssrf";
import { tokenHash } from "../auth";
import { json, type Row } from "./analysis";
const OPEN = ["detected", "pending", "reappeared"];
export async function today(id: string) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const until = new Date(new Date(day + "T00:00:00Z").getTime() + 864e5);
  return db.projectTask.findMany({
    where: {
      projectId: id,
      status: { in: OPEN },
      OR: [{ dueAt: null }, { dueAt: { lt: until } }],
    },
    orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
    take: 100,
  });
}
async function daily(id: string) {
  const [p, tasks] = await Promise.all([project(id), today(id)]);
  if (tasks.length)
    await queueNotice(
      id,
      "daily.digest",
      `daily:${new Date().toISOString().slice(0, 10)}`,
      {
        message: `${p.name}: ${tasks.length} tareas pendientes. ${tasks
          .slice(0, 5)
          .map((t) => t.title)
          .join("; ")}`,
        tasks: tasks
          .slice(0, 10)
          .map((t) => ({
            id: t.id,
            title: t.title,
            url: t.url,
            dueAt: t.dueAt,
          })),
      },
    );
  return { tasks: tasks.length };
}
export const module: ProModule = {
  prefix: "ops",
  routes: {
    GET: {
      "": async ({ id }) => {
        const tasks = await today(id);
        const templates = await db.savedView.findMany({
          where: { projectId: id, scope: "task-template" },
        });
        const rows: Row[] = tasks.map((t) => ({
          id: t.id,
          tipo: "Qué hago hoy",
          tarea: t.title,
          url: t.url,
          prioridad: t.priority,
          vence: t.dueAt?.toISOString() ?? null,
          responsable: t.assignee,
          estado: t.status,
        }));
        for (const t of templates)
          rows.push({
            id: t.id,
            tipo: "Plantilla de tarea",
            tarea: t.name,
            detalle: JSON.stringify(t.filters),
          });
        return {
          title: "Qué hago hoy y plantillas",
          source: "Tareas persistentes del proyecto",
          notes: [
            "Las tareas mantienen sus estados y responsables entre auditorías. Las notificaciones salen solo a los canales configurados.",
          ],
          rows,
        };
      },
      webhooks: async (c) => {
        await admin(c);
        const hooks = await db.webhook.findMany({
          where: { projectId: c.id },
          select: {
            id: true,
            format: true,
            events: true,
            active: true,
            lastStatus: true,
            lastError: true,
            lastAt: true,
            recipient: true,
            template: true,
          },
        });
        const deliveries = await db.webhookDelivery.findMany({
          where: { projectId: c.id },
          select: {
            id: true,
            event: true,
            status: true,
            attempts: true,
            lastError: true,
            createdAt: true,
          },
          take: 50,
          orderBy: { createdAt: "desc" },
        });
        return { hooks, deliveries };
      },
      access: async (c) => {
        await admin(c);
        return db.projectAccess.findMany({ where: { projectId: c.id } });
      },
      tokens: async (c) => {
        await admin(c);
        return db.apiToken.findMany({
          where: { projectId: c.id },
          select: {
            id: true,
            name: true,
            scope: true,
            revokedAt: true,
            lastUsedAt: true,
            createdAt: true,
          },
        });
      },
    },
    POST: {
      template: async (c) => {
        await admin(c);
        const name = text(c.body.name, 150),
          title = text(c.body.title, 200),
          reason = text(c.body.reason);
        if (!name || !title || !reason)
          throw new ProError(
            "Nombre, título y criterio de finalización requeridos",
          );
        return db.savedView.create({
          data: {
            projectId: c.id,
            scope: "task-template",
            name,
            filters: { title, reason },
            columns: [],
            createdBy: c.user.id,
          },
        });
      },
      "template/apply": async (c) => {
        await admin(c);
        const template = await db.savedView.findFirst({
          where: {
            id: text(c.body.id),
            projectId: c.id,
            scope: "task-template",
          },
        });
        if (!template) throw new ProError("Plantilla no encontrada", 404);
        const f = json(template.filters);
        const task = await db.projectTask.create({
          data: {
            projectId: c.id,
            fingerprint: `template:${randomBytes(12).toString("hex")}`,
            title: String(f.title),
            reason: String(f.reason),
            source: "manual",
            url: text(c.body.url) || null,
          },
        });
        return task;
      },
      webhook: async (c) => {
        await admin(c);
        const format = ["json", "slack", "whatsapp"].includes(c.body.format)
          ? c.body.format
          : "json";
        let url = text(c.body.url);
        const recipient = text(c.body.recipient, 20),
          template = text(c.body.template, 100);
        if (format === "whatsapp") {
          if (
            !/^\d{8,18}$/.test(recipient) ||
            !/^\w+$/.test(template) ||
            !/^\d+$/.test(process.env.WHATSAPP_PHONE_NUMBER_ID ?? "")
          )
            throw new ProError(
              "Configura WHATSAPP_PHONE_NUMBER_ID e indica destinatario y plantilla aprobada",
            );
          url = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION ?? "v23.0"}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
        }
        try {
          const u = assertUrlAllowed(url);
          if (u.protocol !== "https:") throw new Error();
          if (format === "slack" && u.hostname !== "hooks.slack.com")
            throw new Error();
        } catch {
          throw new ProError("URL HTTPS pública inválida para el canal");
        }
        const events = Array.isArray(c.body.events)
          ? c.body.events.filter(
              (s: unknown) =>
                typeof s === "string" &&
                [
                  "*",
                  "daily.digest",
                  "crawl.completed",
                  "alert.created",
                  "task.updated",
                  "report.ready",
                ].includes(s),
            )
          : [];
        if (!events.length) throw new ProError("Elige al menos un evento");
        const secret = randomBytes(32).toString("hex");
        const hook = await db.webhook.create({
          data: {
            projectId: c.id,
            url,
            format,
            recipient: recipient || null,
            template: template || null,
            events,
            secret,
          },
          select: { id: true, format: true },
        });
        return {
          ...hook,
          ...(format === "json" ? { signingSecret: secret } : {}),
        };
      },
      token: async (c) => {
        await admin(c);
        const name = text(c.body.name, 100);
        if (!name) throw new ProError("Nombre requerido");
        const token = randomBytes(32).toString("base64url");
        const t = await db.apiToken.create({
          data: {
            projectId: c.id,
            name,
            scope: "read",
            tokenHash: tokenHash(token),
            createdBy: c.user.id,
          },
          select: { id: true, name: true },
        });
        return { ...t, token };
      },
    },
    PATCH: {
      access: async (c) => {
        await admin(c);
        const p = await project(c.id),
          userId = text(c.body.userId);
        const member = await db.membership.findUnique({
          where: { userId_workspaceId: { userId, workspaceId: p.workspaceId } },
        });
        if (!member)
          throw new ProError(
            "El usuario debe pertenecer al espacio de trabajo",
          );
        if (!["viewer", "editor"].includes(c.body.role))
          throw new ProError("Rol inválido");
        return db.projectAccess.upsert({
          where: { projectId_userId: { projectId: c.id, userId } },
          create: { projectId: c.id, userId, role: c.body.role },
          update: { role: c.body.role },
        });
      },
    },
    DELETE: {
      webhook: async (c) => {
        await admin(c);
        return db.webhook.deleteMany({
          where: { id: text(c.body.id), projectId: c.id },
        });
      },
      template: async (c) => {
        await admin(c);
        return db.savedView.deleteMany({
          where: {
            id: text(c.body.id),
            projectId: c.id,
            scope: "task-template",
          },
        });
      },
      access: async (c) => {
        await admin(c);
        return db.projectAccess.deleteMany({
          where: { projectId: c.id, userId: text(c.body.userId) },
        });
      },
      token: async (c) => {
        await admin(c);
        return db.apiToken.updateMany({
          where: { projectId: c.id, id: text(c.body.id) },
          data: { revokedAt: new Date() },
        });
      },
    },
  },
  daily,
  afterCrawl: async (crawlId, id) => {
    const p = await project(id);
    return queueNotice(id, "crawl.completed", `crawl:${crawlId}`, {
      crawlId,
      message: `${p.name}: auditoría terminada. Revisa las tareas y los módulos expertos.`,
    });
  },
};
