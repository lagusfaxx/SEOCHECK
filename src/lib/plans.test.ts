import { test } from "node:test";
import assert from "node:assert/strict";
import { INTERNAL_PLAN, PLANS, proLimits, resolvePlan, TRIAL_DAYS } from "./plans";

const past = new Date(Date.now() - 864e5), future = new Date(Date.now() + 864e5);

test("el workspace dueño de la instancia (trusted) no tiene límite de plan ni vence", () => {
  const p = resolvePlan({ plan: "trial", trusted: true, trialEndsAt: past, planValidUntil: null });
  assert.equal(p.key, "internal");
  assert.equal(p.expired, false);
  assert.equal(p.limits, INTERNAL_PLAN);
  assert.ok(p.limits.projects > 1000);
});

const withBilling = (on: boolean, fn: () => void) => {
  const prev = process.env.BILLING_ENABLED;
  process.env.BILLING_ENABLED = on ? "true" : "false";
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.BILLING_ENABLED;
    else process.env.BILLING_ENABLED = prev;
  }
};

test("con cobro: prueba = 1 proyecto y vence", () => withBilling(true, () => {
  const t = resolvePlan({ plan: "trial", trusted: false, trialEndsAt: future, planValidUntil: null });
  assert.equal(t.key, "trial");
  assert.equal(t.limits.projects, 1);
  assert.equal(t.expired, false);
  assert.equal(resolvePlan({ plan: "trial", trusted: false, trialEndsAt: past, planValidUntil: null }).expired, true);
  const seo = resolvePlan({ plan: "seo", trusted: false, trialEndsAt: past, planValidUntil: past });
  assert.equal(seo.limits, PLANS.seo);
  assert.equal(seo.expired, true);
  assert.equal(resolvePlan({ plan: "inventado", trusted: false, trialEndsAt: future, planValidUntil: null }).key, "trial");
}));

test("sin cobro: la prueba pasa a beta gratuita y nada vence", () => withBilling(false, () => {
  const t = resolvePlan({ plan: "trial", trusted: false, trialEndsAt: past, planValidUntil: null });
  assert.equal(t.key, "beta");
  assert.equal(t.limits, PLANS.beta);
  assert.equal(t.expired, false);
  const seo = resolvePlan({ plan: "seo", trusted: false, trialEndsAt: past, planValidUntil: past });
  assert.equal(seo.limits, PLANS.seo);
  assert.equal(seo.expired, false);
}));

test("el plan interno no se ofrece entre los planes contratables", () => {
  assert.ok(!Object.keys(PLANS).includes("internal"));
});

test("la prueba dura 7 días y tiene menos cupo que el plan pagado", () => {
  assert.equal(TRIAL_DAYS, 7);
  for (const k of ["urls", "keywords", "rankings", "briefs", "reports", "images", "ai", "research"] as const) assert.ok(PLANS.trial[k] < PLANS.pro[k], k);
});

test("plan pagado: los cupos escalan por perfil contratado", () => withBilling(true, () => {
  const future2 = new Date(Date.now() + 30 * 864e5);
  const one = resolvePlan({ plan: "pro", trusted: false, trialEndsAt: past, planValidUntil: future2, seats: 1 });
  const three = resolvePlan({ plan: "pro", trusted: false, trialEndsAt: past, planValidUntil: future2, seats: 3 });
  assert.equal(one.key, "pro");
  assert.equal(one.expired, false);
  assert.equal(three.limits.projects, 3);
  assert.equal(three.limits.images, PLANS.pro.images * 3);
  assert.equal(three.limits.urls, PLANS.pro.urls);
  assert.equal(resolvePlan({ plan: "pro", trusted: false, trialEndsAt: past, planValidUntil: past, seats: 1 }).expired, true);
  assert.equal(proLimits(0).projects, 1);
  assert.equal(proLimits(999).projects, 20);
}));
