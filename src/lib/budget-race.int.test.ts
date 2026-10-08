/**
 * Presupuesto sin carreras: dos jobs en paralelo no pueden pasar juntos el chequeo si entre los dos superan el
 * límite. Requiere DATABASE_URL de PRUEBA (limpia ProviderUsage del mes y las reservas).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const hasDb = Boolean(process.env.DATABASE_URL);

before(async () => {
  process.env.SERPENT_MONTHLY_USD = "0.01";
  if (!hasDb) return;
  const { db } = await import("./db");
  await db.budgetReservation.deleteMany({});
  await db.providerUsage.deleteMany({ where: { provider: "serpent" } });
});

after(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  await db.budgetReservation.deleteMany({});
  await db.providerUsage.deleteMany({ where: { provider: "serpent" } });
  await db.$disconnect();
});

test("10 jobs en paralelo, cada uno cabe solo: entran exactamente los que caben juntos", { skip: !hasDb }, async () => {
  const { assertBudget, releaseBudget, BudgetError } = await import("./budget");
  // límite $0.01, cada job reserva $0.003 → caben 3
  const res = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => assertBudget({ serpent: 0.003 }, `job ${i}`, `job-${i}`)));
  const ok = res.filter((r) => r.status === "fulfilled").length;
  assert.equal(ok, 3);
  assert.ok(res.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof BudgetError));
  for (let i = 0; i < 10; i++) await releaseBudget(`job-${i}`);
});

test("lo que un job ya gastó no se cuenta dos veces; al liberar, el cupo vuelve", { skip: !hasDb }, async () => {
  const { assertBudget, releaseBudget } = await import("./budget");
  const { runWithJob } = await import("./jobctx");
  const { logUsage } = await import("./costs");
  // A reserva 0.006 y gasta 0.004 de eso
  await runWithJob("A", async () => {
    await assertBudget({ serpent: 0.006 }, "A");
    await logUsage({ provider: "serpent", endpoint: "quick", units: 1, costUsd: 0.004 });
  });
  // gastado 0.004 + reserva restante de A 0.002 = 0.006 → B puede 0.004 pero no 0.005
  await assert.rejects(() => assertBudget({ serpent: 0.005 }, "B", "B"));
  await assertBudget({ serpent: 0.004 }, "B", "B");
  await releaseBudget("B");
  await releaseBudget("A");
  // sin reservas: solo cuenta lo gastado (0.004) → caben 0.006
  await assertBudget({ serpent: 0.006 }, "C", "C");
  await releaseBudget("C");
});
