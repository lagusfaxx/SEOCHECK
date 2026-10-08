import Stripe from "stripe";
import { db } from "./db";
import { requireWorkspace } from "./auth";
import { isPlan } from "./plans";
export class BillingError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const BILLING_PRODUCTS = ["seo", "agency", "report"] as const;
export type BillingProduct = (typeof BILLING_PRODUCTS)[number];
export function billingConfig() {
  return {
    configured:
      !!process.env.STRIPE_SECRET_KEY &&
      !!process.env.STRIPE_WEBHOOK_SECRET &&
      !!process.env.APP_URL,
    products: BILLING_PRODUCTS.map((product) => ({
      product,
      available: !!process.env[`STRIPE_PRICE_${product.toUpperCase()}`],
    })),
  };
}
function client() {
  if (!process.env.STRIPE_SECRET_KEY)
    throw new BillingError(503, "Stripe está pendiente de configuración");
  return new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 });
}
function origin() {
  const raw = process.env.APP_URL;
  if (!raw) throw new BillingError(503, "Falta APP_URL para Stripe");
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.hostname !== "localhost")
    throw new BillingError(503, "APP_URL debe usar HTTPS");
  return url.origin;
}
export async function createCheckout(
  projectId: string,
  user: { id: string; email: string },
  product: BillingProduct,
) {
  if (!BILLING_PRODUCTS.includes(product))
    throw new BillingError(400, "Producto inválido");
  if (!billingConfig().configured)
    throw new BillingError(
      503,
      "Configura precios, claves y webhook de Stripe antes de cobrar",
    );
  const p = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { workspace: true },
  });
  await requireWorkspace(user.id, p.workspaceId, "admin");
  if (product !== "report" && p.workspace.stripeSubscriptionId)
    throw new BillingError(
      409,
      "Ya existe una suscripción. Adminístrala desde el portal de Stripe.",
    );
  const priceId = process.env[`STRIPE_PRICE_${product.toUpperCase()}`];
  if (!priceId)
    throw new BillingError(
      503,
      "Define el precio de este producto en Stripe y configura su ID en el servidor",
    );
  const stripe = client(),
    price = await stripe.prices.retrieve(priceId);
  if (
    !price.active ||
    !price.unit_amount ||
    price.unit_amount <= 0 ||
    (product === "report"
      ? price.type !== "one_time"
      : price.recurring?.interval !== "month" ||
        price.recurring.interval_count !== 1)
  )
    throw new BillingError(
      503,
      "El precio debe ser positivo: mensual para planes o pago único para informes",
    );
  const order = await db.billingOrder.create({
    data: {
      workspaceId: p.workspaceId,
      product,
      provider: "stripe",
      amount: price.unit_amount,
      currency: price.currency,
    },
  });
  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: product === "report" ? "payment" : "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        ...(p.workspace.stripeCustomerId
          ? { customer: p.workspace.stripeCustomerId }
          : { customer_email: user.email }),
        client_reference_id: order.id,
        metadata: { orderId: order.id, workspaceId: p.workspaceId, product },
        ...(product !== "report"
          ? {
              subscription_data: {
                metadata: {
                  workspaceId: p.workspaceId,
                  product,
                  orderId: order.id,
                },
              },
            }
          : {}),
        success_url: `${origin()}/p/${projectId}/settings?checkout=success`,
        cancel_url: `${origin()}/p/${projectId}/settings?checkout=cancelled`,
      },
      { idempotencyKey: order.id },
    );
    await db.billingOrder.update({
      where: { id: order.id },
      data: { providerId: session.id },
    });
    return { url: session.url };
  } catch (e) {
    await db.billingOrder.update({
      where: { id: order.id },
      data: { status: "error" },
    });
    throw e;
  }
}
export async function billingPortal(projectId: string, userId: string) {
  const p = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { workspace: true },
  });
  await requireWorkspace(userId, p.workspaceId, "admin");
  if (!p.workspace.stripeCustomerId)
    throw new BillingError(400, "Todavía no hay un cliente Stripe asociado");
  return client().billingPortal.sessions.create({
    customer: p.workspace.stripeCustomerId,
    return_url: `${origin()}/p/${projectId}/settings`,
  });
}
export function verifyStripeEvent(payload: string, signature: string) {
  if (!process.env.STRIPE_WEBHOOK_SECRET)
    throw new BillingError(503, "Webhook de Stripe sin configurar");
  return client().webhooks.constructEvent(
    payload,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET,
  );
}
function stripeId(v: string | { id: string } | null | undefined) {
  return typeof v === "string" ? v : v?.id;
}
function paidPlan(s: Stripe.Subscription) {
  const price = s.items.data[0]?.price;
  const plan =
    price?.id === process.env.STRIPE_PRICE_AGENCY
      ? "agency"
      : price?.id === process.env.STRIPE_PRICE_SEO
        ? "seo"
        : null;
  if (!plan || !isPlan(plan) || !["active", "trialing"].includes(s.status))
    return null;
  if (s.items.data.length !== 1 || s.items.data[0].quantity !== 1) return null;
  const until = Math.min(...s.items.data.map((i) => i.current_period_end));
  if (!Number.isFinite(until)) return null;
  return { plan, planValidUntil: new Date(until * 1000) };
}
/** Signed events are idempotent. Retrieve current objects so old deliveries cannot restore stale entitlements. */
export async function handleStripeEvent(
  event: Stripe.Event,
  stripe: Stripe = client(),
) {
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const received = event.data.object as Stripe.Checkout.Session;
    const session = await stripe.checkout.sessions.retrieve(received.id, {
      expand: ["subscription"],
    });
    if (session.payment_status !== "paid") return;
    const order = await db.billingOrder.findUnique({
      where: { providerId: session.id },
    });
    if (
      !order ||
      order.id !== session.metadata?.orderId ||
      order.workspaceId !== session.metadata?.workspaceId ||
      session.amount_total !== order.amount ||
      session.currency !== order.currency
    )
      throw new BillingError(400, "El pago no corresponde al pedido");
    const subscription = session.subscription as Stripe.Subscription | null;
    const entitlement = subscription ? paidPlan(subscription) : null;
    if (
      order.product !== "report" &&
      (!entitlement || entitlement.plan !== order.product)
    )
      throw new BillingError(400, "Plan de Stripe inválido");
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${order.workspaceId}))`;
      if (await tx.stripeEvent.findUnique({ where: { id: event.id } })) return;
      const current = await tx.billingOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      if (current.status !== "paid") {
        await tx.billingOrder.update({
          where: { id: order.id },
          data: { status: "paid", paidAt: new Date() },
        });
        await tx.workspace.update({
          where: { id: order.workspaceId },
          data: {
            stripeCustomerId: stripeId(session.customer) ?? null,
            ...(order.product === "report"
              ? { reportCredits: { increment: 1 } }
              : { ...entitlement!, stripeSubscriptionId: subscription!.id }),
          },
        });
      }
      await tx.stripeEvent.create({ data: { id: event.id, type: event.type } });
    });
    return;
  }
  if (
    [
      "invoice.paid",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ].includes(event.type)
  ) {
    const object = event.data.object as any;
    const subscriptionId = event.type.startsWith("customer.subscription")
      ? object.id
      : stripeId(object.parent?.subscription_details?.subscription);
    if (!subscriptionId) return;
    const w = await db.workspace.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
    });
    if (!w) return;
    const sub = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["latest_invoice"],
    });
    const invoice = sub.latest_invoice as Stripe.Invoice | null;
    const paid =
      invoice && typeof invoice !== "string" && invoice.status === "paid";
    const entitlement = paid ? paidPlan(sub) : null;
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${w.id}))`;
      if (await tx.stripeEvent.findUnique({ where: { id: event.id } })) return;
      const current = await tx.workspace.findUniqueOrThrow({
        where: { id: w.id },
      });
      if (current.stripeSubscriptionId === sub.id) {
        if (entitlement)
          await tx.workspace.update({ where: { id: w.id }, data: entitlement });
        else if (
          sub.status === "canceled" ||
          sub.status === "unpaid" ||
          sub.status === "incomplete_expired"
        )
          await tx.workspace.update({
            where: { id: w.id },
            data: {
              plan: "trial",
              planValidUntil: null,
              stripeSubscriptionId: null,
            },
          });
      }
      await tx.stripeEvent.create({ data: { id: event.id, type: event.type } });
    });
  }
}
