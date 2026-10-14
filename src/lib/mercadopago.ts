/**
 * Cobro del plan FSV Search con suscripciones de Mercado Pago (preapproval): el cliente autoriza el cargo mensual
 * en Mercado Pago y nosotros solo guardamos el id de la suscripción. Mercado Pago no ofrece PAC (débito de cuenta
 * bancaria) en Chile: cobra la tarjeta (crédito o débito) automáticamente cada mes.
 *
 * Nunca confiamos en el cuerpo del webhook ni en la URL de vuelta: siempre releemos la suscripción en la API de
 * Mercado Pago con nuestro token, y solo la aplicamos si corresponde a un pedido nuestro con el mismo monto.
 */
import crypto from "node:crypto";
import { db } from "./db";
import { requireWorkspace } from "./auth";
import { BillingError } from "./billing";
import { billingEnabled, MAX_SEATS, planPriceClp } from "./plans";

const API = "https://api.mercadopago.com";
/** Días de gracia después de la fecha de cobro, por si Mercado Pago reintenta un pago rechazado. */
const GRACE_DAYS = 3;

export type Preapproval = {
  id: string;
  status: "pending" | "authorized" | "paused" | "cancelled" | string;
  external_reference?: string | null;
  payer_email?: string | null;
  init_point?: string;
  next_payment_date?: string | null;
  auto_recurring?: { transaction_amount?: number; currency_id?: string; frequency?: number; frequency_type?: string };
  summarized?: { charged_quantity?: number | null; last_charged_date?: string | null } | null;
};

/** Error de la API de Mercado Pago, con su estado HTTP (404 = el recurso no existe). */
export class MpApiError extends BillingError {
  constructor(public upstream: number, message: string) {
    super(502, message);
  }
}

export const mpConfigured = () => Boolean(process.env.MP_ACCESS_TOKEN?.trim());

function origin() {
  const raw = process.env.APP_URL;
  if (!raw) throw new BillingError(503, "Falta APP_URL para Mercado Pago");
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new BillingError(503, "APP_URL debe usar HTTPS para Mercado Pago");
  return url.origin;
}

type Fetch = typeof fetch;
let fetcher: Fetch = (...a) => fetch(...a);
/** Para pruebas: reemplaza la llamada HTTP a Mercado Pago. */
export const setMpFetch = (f: Fetch | null) => {
  fetcher = f ?? ((...a) => fetch(...a));
};

async function mp<T>(path: string, init: { method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  if (!mpConfigured()) throw new BillingError(503, "Mercado Pago está pendiente de configuración");
  const res = await fetcher(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN!.trim()}`,
      "Content-Type": "application/json",
      ...(init.idempotencyKey ? { "X-Idempotency-Key": init.idempotencyKey } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    (res.status === 404 ? console.warn : console.error)("[mercadopago]", init.method ?? "GET", path, res.status, j?.message ?? j);
    throw new MpApiError(res.status, `Mercado Pago respondió con un error${j?.message ? `: ${String(j.message).slice(0, 200)}` : ""}. Intenta de nuevo en unos minutos.`);
  }
  return j as T;
}

const seatsOf = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SEATS) throw new BillingError(400, `Elige entre 1 y ${MAX_SEATS} perfiles`);
  return n;
};
const reason = (seats: number) => `FSV Search · ${seats} ${seats === 1 ? "perfil" : "perfiles"}`;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5);
const addMonth = (d: Date) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + 1);
  return x;
};

async function projectWorkspace(projectId: string, userId: string) {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { workspace: true } });
  await requireWorkspace(userId, p.workspaceId, "admin");
  if (p.workspace.trusted) throw new BillingError(400, "El workspace interno no necesita suscripción");
  return p;
}

/** Crea la suscripción en Mercado Pago y devuelve el link donde el cliente la autoriza con su tarjeta. */
export async function createSubscription(projectId: string, user: { id: string; email: string }, rawSeats: unknown, rawEmail: unknown) {
  if (!billingEnabled()) throw new BillingError(404, "Los pagos no están habilitados durante la beta");
  const seats = seatsOf(rawSeats);
  const p = await projectWorkspace(projectId, user.id);
  const w = p.workspace;
  if (w.mpPreapprovalId && w.mpStatus === "authorized")
    throw new BillingError(409, "Ya tienes una suscripción activa: cambia la cantidad de perfiles desde aquí mismo.");
  const projects = await db.project.count({ where: { workspaceId: w.id } });
  if (seats < projects) throw new BillingError(400, `Tienes ${projects} perfiles creados: elige al menos ${projects}.`);
  const payerEmail = typeof rawEmail === "string" && rawEmail.trim() ? rawEmail.trim().toLowerCase() : user.email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail) || payerEmail.length > 200) throw new BillingError(400, "Escribe el correo de tu cuenta de Mercado Pago");

  const amount = planPriceClp() * seats;
  const order = await db.billingOrder.create({ data: { workspaceId: w.id, product: "pro", provider: "mercadopago", amount, currency: "CLP", seats } });
  try {
    const pre = await mp<Preapproval>("/preapproval", {
      method: "POST",
      idempotencyKey: order.id,
      body: {
        reason: reason(seats),
        external_reference: w.id,
        payer_email: payerEmail,
        back_url: `${origin()}/p/${projectId}/settings?checkout=mp`,
        status: "pending",
        auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: amount, currency_id: "CLP" },
      },
    });
    if (!pre.id || !pre.init_point) throw new BillingError(502, "Mercado Pago no devolvió el link de pago");
    await db.billingOrder.update({ where: { id: order.id }, data: { providerId: pre.id } });
    return { url: pre.init_point };
  } catch (e) {
    await db.billingOrder.update({ where: { id: order.id }, data: { status: "error" } });
    throw e;
  }
}

/**
 * Aplica el estado real de una suscripción al workspace. Idempotente: se puede llamar desde el webhook, la URL de
 * vuelta y la sincronización diaria. Devuelve false si la suscripción no es nuestra o no calza con el pedido.
 */
export async function applyPreapproval(pre: Preapproval): Promise<boolean> {
  const order = await db.billingOrder.findUnique({ where: { providerId: pre.id } });
  if (!order || order.provider !== "mercadopago" || order.workspaceId !== pre.external_reference) return false;
  if (pre.auto_recurring?.currency_id !== "CLP" || pre.auto_recurring.transaction_amount !== order.amount) {
    console.error("[mercadopago] la suscripción no calza con el pedido", pre.id);
    return false;
  }
  let replaced: string | null = null;
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${order.workspaceId}))`;
    const w = await tx.workspace.findUniqueOrThrow({ where: { id: order.workspaceId } });
    const current = w.mpPreapprovalId === pre.id;
    if (pre.status === "authorized") {
      const charged = pre.summarized?.last_charged_date ? new Date(pre.summarized.last_charged_date) : null;
      const next = pre.next_payment_date ? new Date(pre.next_payment_date) : null;
      // pagado: hasta el próximo cobro (+ gracia). Recién autorizada y sin cobro aún: unos días hasta que llegue el primero.
      const paidUntil = charged ? addDays(next && next > charged ? next : addMonth(charged), GRACE_DAYS) : addDays(new Date(), GRACE_DAYS);
      const keep = current && w.planValidUntil && w.plan === "pro" ? w.planValidUntil : null;
      if (!current && w.mpPreapprovalId && w.mpStatus === "authorized") replaced = w.mpPreapprovalId;
      await tx.workspace.update({
        where: { id: w.id },
        data: { plan: "pro", seats: order.seats, mpPreapprovalId: pre.id, mpStatus: pre.status, planValidUntil: keep && keep > paidUntil ? keep : paidUntil },
      });
      if (charged && order.status !== "paid") await tx.billingOrder.update({ where: { id: order.id }, data: { status: "paid", paidAt: charged } });
    } else if (current) {
      // pausada o cancelada: no se extiende; el plan sigue hasta el fin del periodo pagado
      await tx.workspace.update({ where: { id: w.id }, data: { mpStatus: pre.status } });
    }
    if (pre.status === "cancelled" && order.status === "pending") await tx.billingOrder.update({ where: { id: order.id }, data: { status: "cancelled" } });
  });
  // una suscripción nueva reemplaza a la anterior: no cobrar dos veces
  if (replaced) await mp(`/preapproval/${replaced}`, { method: "PUT", body: { status: "cancelled" } }).catch((e) => console.error("[mercadopago] no se pudo cancelar la anterior", replaced, e));
  return true;
}

export async function syncPreapproval(id: string) {
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) return false;
  return applyPreapproval(await mp<Preapproval>(`/preapproval/${encodeURIComponent(id)}`));
}

/** A la vuelta desde Mercado Pago: sincroniza la suscripción indicada (si es de este workspace) y la vigente. */
export async function syncWorkspace(projectId: string, userId: string, preapprovalId?: unknown) {
  const p = await projectWorkspace(projectId, userId);
  const ids = new Set<string>();
  if (typeof preapprovalId === "string") {
    const o = await db.billingOrder.findUnique({ where: { providerId: preapprovalId } });
    if (o?.workspaceId === p.workspaceId) ids.add(preapprovalId);
  }
  if (p.workspace.mpPreapprovalId) ids.add(p.workspace.mpPreapprovalId);
  // pedidos recientes sin confirmar (el cliente puede volver antes que el webhook)
  for (const o of await db.billingOrder.findMany({ where: { workspaceId: p.workspaceId, provider: "mercadopago", status: "pending", providerId: { not: null }, createdAt: { gte: addDays(new Date(), -2) } }, select: { providerId: true } }))
    ids.add(o.providerId!);
  for (const id of ids) await syncPreapproval(id);
  return { ok: true };
}

/** Cambia la cantidad de perfiles: desde el próximo cobro se cobra el nuevo monto. */
export async function changeSeats(projectId: string, userId: string, rawSeats: unknown) {
  const seats = seatsOf(rawSeats);
  const p = await projectWorkspace(projectId, userId);
  const w = p.workspace;
  if (!w.mpPreapprovalId || w.mpStatus !== "authorized") throw new BillingError(409, "No hay una suscripción activa");
  const projects = await db.project.count({ where: { workspaceId: w.id } });
  if (seats < projects) throw new BillingError(400, `Tienes ${projects} perfiles creados: elimina alguno antes de bajar a ${seats}.`);
  const amount = planPriceClp() * seats;
  await mp(`/preapproval/${w.mpPreapprovalId}`, { method: "PUT", body: { reason: reason(seats), auto_recurring: { transaction_amount: amount, currency_id: "CLP" } } });
  await db.$transaction([
    db.billingOrder.update({ where: { providerId: w.mpPreapprovalId }, data: { amount, seats } }),
    db.workspace.update({ where: { id: w.id }, data: { seats } }),
  ]);
  return { ok: true, seats };
}

/** Cancela la suscripción: no se vuelve a cobrar y el plan sigue hasta el fin del periodo pagado. */
export async function cancelSubscription(projectId: string, userId: string) {
  const p = await projectWorkspace(projectId, userId);
  const id = p.workspace.mpPreapprovalId;
  if (!id) throw new BillingError(409, "No hay una suscripción para cancelar");
  await mp(`/preapproval/${id}`, { method: "PUT", body: { status: "cancelled" } });
  await syncPreapproval(id);
  return { ok: true };
}

/**
 * Firma del webhook (x-signature: "ts=…,v1=…"): HMAC-SHA256 con la clave secreta del panel de Mercado Pago sobre
 * "id:{data.id};request-id:{x-request-id};ts:{ts};".
 */
export function verifyMpSignature(signature: string | null, requestId: string | null, dataId: string, secret = process.env.MP_WEBHOOK_SECRET) {
  if (!secret) return false;
  if (!signature) return false;
  const parts = Object.fromEntries(signature.split(",").map((kv) => kv.split("=").map((s) => s.trim()) as [string, string]));
  const ts = parts.ts, v1 = parts.v1;
  if (!ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifest = `${id ? `id:${id};` : ""}${requestId ? `request-id:${requestId};` : ""}ts:${ts};`;
  const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1.toLowerCase()));
}

/**
 * Procesa un aviso de Mercado Pago: suscripción creada/cambiada o cobro mensual. Si el recurso no existe (404, p. ej.
 * "Simular notificación" del panel, que manda id 123456) se ignora: reintentarlo no lo va a hacer existir.
 */
export async function handleMpNotification(type: string, dataId: string) {
  try {
    return await processNotification(type, dataId);
  } catch (e) {
    if (e instanceof MpApiError && e.upstream === 404) {
      console.warn("[mercadopago] aviso ignorado: no existe en Mercado Pago", type, dataId);
      return false;
    }
    throw e;
  }
}

async function processNotification(type: string, dataId: string) {
  if (type === "subscription_preapproval") return syncPreapproval(dataId);
  if (type === "subscription_authorized_payment") {
    if (!/^[0-9]{1,30}$/.test(dataId)) return false;
    const pay = await mp<{ preapproval_id?: string }>(`/authorized_payments/${dataId}`);
    return pay.preapproval_id ? syncPreapproval(pay.preapproval_id) : false;
  }
  return false;
}

/** Respaldo diario por si se pierde un webhook: resincroniza las suscripciones vigentes. */
export async function syncAllSubscriptions() {
  if (!mpConfigured()) return { skipped: true };
  const ws = await db.workspace.findMany({ where: { mpPreapprovalId: { not: null } }, select: { mpPreapprovalId: true } });
  let n = 0;
  for (const w of ws) {
    await syncPreapproval(w.mpPreapprovalId!).then(() => n++).catch((e) => console.error("[mercadopago] sync", w.mpPreapprovalId, e));
  }
  return { synced: n };
}
