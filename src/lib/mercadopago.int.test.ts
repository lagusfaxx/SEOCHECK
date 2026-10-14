import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { db } from "./db";
import { applyPreapproval, createSubscription, handleMpNotification, setMpFetch, verifyMpSignature, type Preapproval } from "./mercadopago";
import { consumeQuota, PlanLimitError, refundQuota, resolvePlan, withQuota } from "./plans";

const enabled = !!process.env.DATABASE_URL;
const env = { ...process.env };
let wid: string, pid: string, uid: string;
const suffix = crypto.randomUUID().slice(0, 8);

before(async () => {
  if (!enabled) return;
  process.env.BILLING_ENABLED = "true";
  process.env.MP_ACCESS_TOKEN = "TEST-token";
  process.env.APP_URL = "https://seo.example.cl";
  delete process.env.PLAN_PRICE_CLP;
  const u = await db.user.create({ data: { email: `mp-${suffix}@example.com`, passwordHash: "x" } });
  uid = u.id;
  const w = await db.workspace.create({ data: { name: `mp ${suffix}`, members: { create: { userId: uid, role: "owner" } } } });
  wid = w.id;
  pid = (await db.project.create({ data: { workspaceId: wid, name: "p", domain: `mp-${suffix}.cl` } })).id;
});
after(async () => {
  setMpFetch(null);
  process.env = env;
  if (!enabled) return;
  await db.workspace.deleteMany({ where: { id: wid } });
  await db.user.deleteMany({ where: { id: uid } });
  await db.$disconnect();
});

test("firma del webhook de Mercado Pago", () => {
  const secret = "s3cr3t", ts = "1700000000", rid = "req-1";
  const v1 = crypto.createHmac("sha256", secret).update(`id:abc123;request-id:${rid};ts:${ts};`).digest("hex");
  assert.equal(verifyMpSignature(`ts=${ts},v1=${v1}`, rid, "ABC123", secret), true);
  assert.equal(verifyMpSignature(`ts=${ts},v1=${v1}`, rid, "otro", secret), false);
  assert.equal(verifyMpSignature(`ts=${ts},v1=${v1}`, "req-2", "abc123", secret), false);
  assert.equal(verifyMpSignature(null, rid, "abc123", secret), false);
  assert.equal(verifyMpSignature(`ts=${ts},v1=${v1}`, rid, "abc123", ""), false);
});

test("una prueba nueva dura 7 días", { skip: !enabled }, async () => {
  const w = await db.workspace.findUniqueOrThrow({ where: { id: wid } });
  const days = (w.trialEndsAt.getTime() - Date.now()) / 864e5;
  assert.ok(days > 6.9 && days <= 7.01, String(days));
  assert.equal(resolvePlan(w).key, "trial");
});

test("cupo de imágenes con IA: se descuenta, se devuelve si falla y se bloquea al llegar al límite", { skip: !enabled }, async () => {
  await assert.rejects(() => withQuota(pid, "images", async () => { throw new Error("openai caído"); }), /openai caído/);
  for (let i = 0; i < 3; i++) await withQuota(pid, "images", async () => "ok");
  await assert.rejects(() => consumeQuota(pid, "images"), PlanLimitError);
  await refundQuota(wid, "images", 3);
  await db.quotaUsage.deleteMany({ where: { workspaceId: wid } });
});

test("tope de gasto por workspace: la prueba no puede pasar su límite en USD", { skip: !enabled }, async () => {
  const { assertBudget, WorkspaceSpendError } = await import("./budget");
  await db.workspace.update({ where: { id: wid }, data: { plan: "trial" } });
  await assertBudget({ llm: 0.01 }, "caption", undefined, pid);
  await db.providerUsage.create({ data: { provider: "llm", endpoint: "test", units: 1, projectId: pid, costUsd: 0.495 } });
  await assert.rejects(() => assertBudget({ llm: 0.01 }, "caption", undefined, pid), WorkspaceSpendError);
  await db.providerUsage.deleteMany({ where: { projectId: pid } });
});

test("suscripción: checkout, activación, monto que no calza y webhook", { skip: !enabled }, async () => {
  const calls: { url: string; method: string; body: any }[] = [];
  let pre: Preapproval = { id: "pre_" + suffix, status: "pending", external_reference: wid, init_point: "https://mp.example/checkout", auto_recurring: { transaction_amount: 19980, currency_id: "CLP" } };
  setMpFetch(async (url, init) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    if (u.endsWith("/preapproval") && init?.method === "POST") return Response.json(pre);
    if (u.includes("/authorized_payments/")) return Response.json({ preapproval_id: pre.id });
    if (u.includes(`/preapproval/${pre.id}`)) return Response.json(pre);
    return Response.json({ message: "not found" }, { status: 404 });
  });

  const { url } = await createSubscription(pid, { id: uid, email: `mp-${suffix}@example.com` }, 2, "");
  assert.equal(url, "https://mp.example/checkout");
  const sent = calls[0].body;
  assert.equal(sent.external_reference, wid);
  assert.equal(sent.auto_recurring.transaction_amount, 19980);
  assert.equal(sent.auto_recurring.currency_id, "CLP");
  assert.equal(sent.back_url, `https://seo.example.cl/p/${pid}/settings?checkout=mp`);
  await assert.rejects(() => createSubscription(pid, { id: uid, email: "x@example.com" }, 0, ""), /perfiles/);

  // pendiente: no cambia nada
  assert.equal(await applyPreapproval(pre), true);
  assert.equal((await db.workspace.findUniqueOrThrow({ where: { id: wid } })).plan, "trial");

  // otro monto (manipulado): se ignora
  assert.equal(await applyPreapproval({ ...pre, status: "authorized", auto_recurring: { transaction_amount: 10, currency_id: "CLP" } }), false);
  // de otro workspace: se ignora
  assert.equal(await applyPreapproval({ ...pre, status: "authorized", external_reference: "otro" }), false);

  // autorizada y cobrada (llega por webhook de cobro mensual)
  const charged = new Date();
  pre = { ...pre, status: "authorized", summarized: { last_charged_date: charged.toISOString() }, next_payment_date: new Date(charged.getTime() + 30 * 864e5).toISOString() };
  assert.equal(await handleMpNotification("subscription_authorized_payment", "123456"), true);
  let w = await db.workspace.findUniqueOrThrow({ where: { id: wid } });
  assert.equal(w.plan, "pro");
  assert.equal(w.seats, 2);
  assert.equal(w.mpPreapprovalId, pre.id);
  assert.ok(w.planValidUntil! > new Date(Date.now() + 32 * 864e5));
  const plan = resolvePlan(w);
  assert.equal(plan.expired, false);
  assert.equal(plan.limits.projects, 2);
  assert.equal((await db.billingOrder.findUniqueOrThrow({ where: { providerId: pre.id } })).status, "paid");

  // cancelada: no se extiende ni se corta antes de tiempo
  const until = w.planValidUntil;
  assert.equal(await handleMpNotification("subscription_preapproval", pre.id), true);
  pre = { ...pre, status: "cancelled" };
  await applyPreapproval(pre);
  w = await db.workspace.findUniqueOrThrow({ where: { id: wid } });
  assert.equal(w.mpStatus, "cancelled");
  assert.equal(w.plan, "pro");
  assert.deepEqual(w.planValidUntil, until);
});
