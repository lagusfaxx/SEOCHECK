import { createHmac } from "node:crypto";
import { db } from "../db";
import { safeFetch } from "../net/ssrf";
import { json } from "./analysis";
export const signature = (secret: string, body: string) =>
  "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
export async function queueNotice(
  projectId: string,
  event: string,
  eventKey: string,
  payload: Record<string, unknown>,
) {
  const hooks = await db.webhook.findMany({
    where: { projectId, active: true, events: { hasSome: [event, "*"] } },
  });
  for (const h of hooks)
    await db.webhookDelivery.upsert({
      where: { webhookId_eventKey: { webhookId: h.id, eventKey } },
      create: {
        projectId,
        webhookId: h.id,
        eventKey,
        event,
        payload: JSON.parse(JSON.stringify(payload)),
      },
      update: {},
    });
  return { queued: hooks.length };
}
export async function deliverNotices(send: typeof safeFetch = safeFetch) {
  const pending = await db.webhookDelivery.findMany({
    where: {
      status: "pending",
      nextAt: { lte: new Date() },
      attempts: { lt: 5 },
    },
    include: { webhook: true },
    take: 30,
    orderBy: { nextAt: "asc" },
  });
  for (const d of pending) {
    const claimed = await db.webhookDelivery.updateMany({
      where: { id: d.id, status: "pending", nextAt: { lte: new Date() } },
      data: {
        nextAt: new Date(Date.now() + 5 * 60e3),
        attempts: { increment: 1 },
      },
    });
    if (!claimed.count) continue;
    if (!d.webhook.active) {
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: { status: "cancelled" },
      });
      continue;
    }
    const h = d.webhook,
      p = json(d.payload),
      message = String(
        p.message ?? `${d.event}: ${p.title ?? "Actividad del proyecto"}`,
      ).slice(0, 3000);
    let body: Record<string, unknown> = { event: d.event, id: d.id, data: p };
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Seocheck-Delivery": d.id,
    };
    try {
      if (h.format === "slack") body = { text: message };
      if (h.format === "whatsapp") {
        if (!process.env.WHATSAPP_ACCESS_TOKEN)
          throw new Error("Falta WHATSAPP_ACCESS_TOKEN en el servidor");
        headers.Authorization = `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`;
        body = {
          messaging_product: "whatsapp",
          to: h.recipient,
          type: "template",
          template: {
            name: h.template,
            language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? "es" },
            components: [
              { type: "body", parameters: [{ type: "text", text: message }] },
            ],
          },
        };
      }
      const encoded = JSON.stringify(body);
      headers["X-Seocheck-Signature"] = signature(h.secret, encoded);
      const response = await send(h.url, {
        method: "POST",
        headers,
        body: encoded,
        timeoutMs: 10000,
        maxRedirects: 0,
      });
      await response.res.body?.cancel();
      if (!response.res.ok) throw new Error(`HTTP ${response.res.status}`);
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: { status: "sent", lastError: null },
      });
      await db.webhook.update({
        where: { id: h.id },
        data: {
          lastStatus: response.res.status,
          lastError: null,
          lastAt: new Date(),
        },
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status: d.attempts >= 4 ? "failed" : "pending",
          lastError: error.slice(0, 500),
          nextAt: new Date(
            Date.now() + Math.min(3600, 60 * 2 ** d.attempts) * 1000,
          ),
        },
      });
      await db.webhook.update({
        where: { id: h.id },
        data: { lastError: error.slice(0, 500), lastAt: new Date() },
      });
    }
  }
  return { processed: pending.length };
}
