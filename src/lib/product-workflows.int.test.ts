import { runInlineJob } from "./inline-job";
import { currentJobRunId } from "./jobctx";
import { logUsage } from "./costs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { db } from "./db";
import {
  syncCrawlTasks,
  setTaskStatus,
  setTaskGroupStatus,
  projectActions,
} from "./tasks";
import { issueIdentity, canAutoResolve, observedStatus } from "./task-rules";
import {
  auditComparison,
  csvCell,
  executivePdf,
  executiveReport,
  nextReportAt,
  saveReport,
} from "./reporting";
import {
  withProjectQuota,
  createProjectWithinPlan,
  PlanLimitError,
} from "./plans";
import { storeBrief, regenerateSection } from "./content/brief-tools";
import { validateBusinessClaims, validateBrief } from "./content/claims";
import {
  fallbackBrief,
  type Brief,
  type ContentResult,
} from "./content/analyze";
import { handleStripeEvent, verifyStripeEvent } from "./billing";
import { PRODUCT_GETS, PRODUCT_PATCHS, PRODUCT_POSTS } from "./product-api";
const enabled = !!process.env.DATABASE_URL;
let wid: string, pid: string, otherPid: string;
const suffix = crypto.randomUUID();
before(async () => {
  if (!enabled) return;
  const w = await db.workspace.create({
    data: { name: `test-product-${suffix}`, plan: "agency" },
  });
  wid = w.id;
  pid = (
    await db.project.create({
      data: { workspaceId: wid, name: "Demo", domain: "ejemplo.cl" },
    })
  ).id;
  otherPid = (
    await db.project.create({
      data: { workspaceId: wid, name: "Otro", domain: "otro.cl" },
    })
  ).id;
});
after(async () => {
  if (!enabled) return;
  await db.stripeEvent.deleteMany({
    where: { id: { startsWith: `evt_${suffix}` } },
  });
  await db.providerUsage.deleteMany({
    where: { projectId: { in: [pid, otherPid] } },
  });
  await db.workspace.delete({ where: { id: wid } });
  await db.$disconnect();
});
const brief: Brief = {
  kind: "article",
  titles: ["Tema"],
  metas: ["Resumen"],
  outline: [{ id: "h", tag: "h2", text: "Cómo empezar", state: "required" }],
  faq: [],
};
const ctx = (id = pid, body: any = {}, query = "") => ({
  id,
  body,
  url: new URL(`https://app.local/?${query}`),
  user: { id: "test", email: "test@ejemplo.cl" },
});
async function crawl(status = "completed", issue = true, start = Date.now()) {
  const c = await db.crawl.create({
    data: {
      projectId: pid,
      status,
      startedAt: new Date(start),
      finishedAt: new Date(start),
      stats: { health: issue ? 84 : 91 },
    },
  });
  await db.page.create({
    data: { crawlId: c.id, url: "https://ejemplo.cl/a", status: 200 },
  });
  if (issue)
    await db.issue.create({
      data: {
        crawlId: c.id,
        url: "https://ejemplo.cl/a",
        code: "title_missing",
        severity: "warning",
      },
    });
  return c;
}

test("Estados: ignorados persisten; corregidos solo reaparecen en una nueva observación", () => {
  assert.equal(observedStatus("ignored", false), "ignored");
  assert.equal(observedStatus("resolved", true), "resolved");
  assert.equal(observedStatus("resolved", false), "reappeared");
  assert.equal(canAutoResolve("partial", new Set(["a"]), "a"), false);
  assert.equal(canAutoResolve("completed", new Set(["a"]), "b"), false);
});
test("CSV escapa fórmulas y comillas; fecha mensual no salta febrero", () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(
    nextReportAt("monthly", new Date("2027-01-31T12:00:00Z")).toISOString(),
    "2027-02-28T12:00:00.000Z",
  );
});
test("Validador rechaza precios y garantías sin respaldo propio", () => {
  const b = { ...brief, metas: ["Desde $19990 con garantía de por vida"] };
  assert.ok(validateBusinessClaims(b, "").length >= 2);
  assert.equal(
    validateBusinessClaims(b, "Desde $19990 con garantía de por vida").length,
    0,
  );
});
test(
  "Tareas: ciclo completo, parcial conservador y agrupación",
  { skip: !enabled },
  async () => {
    const c1 = await crawl("completed", true, Date.now() - 5000);
    await syncCrawlTasks(c1.id);
    let t = await db.projectTask.findUniqueOrThrow({
      where: {
        projectId_fingerprint: {
          projectId: pid,
          fingerprint: issueIdentity("title_missing", "https://ejemplo.cl/a"),
        },
      },
    });
    assert.equal(t.status, "detected");
    await setTaskStatus(pid, t.id, "pending", "test");
    const partial = await crawl("partial", false, Date.now() - 4000);
    await syncCrawlTasks(partial.id);
    assert.equal(
      (await db.projectTask.findUniqueOrThrow({ where: { id: t.id } })).status,
      "pending",
    );
    const c2 = await crawl("completed", false, Date.now() - 3000);
    await syncCrawlTasks(c2.id);
    assert.equal(
      (await db.projectTask.findUniqueOrThrow({ where: { id: t.id } })).status,
      "resolved",
    );
    const c3 = await crawl("completed", true, Date.now() - 2000);
    await syncCrawlTasks(c3.id);
    assert.equal(
      (await db.projectTask.findUniqueOrThrow({ where: { id: t.id } })).status,
      "reappeared",
    );
    await setTaskGroupStatus(pid, t.id, "ignored", "test");
    const c4 = await crawl("completed", true, Date.now() - 1000);
    await syncCrawlTasks(c4.id);
    assert.equal(
      (await db.projectTask.findUniqueOrThrow({ where: { id: t.id } })).status,
      "ignored",
    );
    await syncCrawlTasks(c1.id);
    assert.equal(
      (await db.projectTask.findUniqueOrThrow({ where: { id: t.id } }))
        .lastCrawlId,
      c4.id,
    );
    await assert.rejects(() =>
      setTaskStatus(otherPid, t.id, "resolved", "test"),
    );
    assert.equal((await projectActions(pid)).actions.length, 0);
  },
);
test(
  "Comparación y PDF conservan datos medidos; no afirman correcciones en parciales",
  { skip: !enabled },
  async () => {
    const c = await auditComparison(pid);
    assert.equal(c?.health, 84);
    assert.ok(c?.previousId);
    const pdf = await executivePdf({
      project: "Demo",
      domain: "ejemplo.cl",
      generatedAt: new Date().toISOString(),
      comparison: c,
      actions: [],
      improved: 0,
      traffic: { clicks: null, impressions: null },
      branding: {},
      findings: [],
      sources: [],
      queries: [],
      speed: [],
    });
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.length > 1000);
    await crawl("partial", false, Date.now() + 10);
    assert.equal((await auditComparison(pid))?.resolved, null);
  },
);
test(
  "Historial de brief y aislamiento de versiones de otro proyecto",
  { skip: !enabled },
  async () => {
    const a = await db.contentAnalysis.create({
      data: {
        projectId: pid,
        url: "https://ejemplo.cl/a",
        keyword: "tema",
        brief: brief as any,
      },
    });
    await storeBrief(a.id, { ...brief, titles: ["Versión dos"] }, "edit");
    assert.equal(
      await db.briefVersion.count({ where: { contentId: a.id } }),
      2,
    );
    await storeBrief(a.id, { ...brief, titles: ["Versión dos"] }, "edit");
    assert.equal(
      await db.briefVersion.count({ where: { contentId: a.id } }),
      2,
    );
    await assert.rejects(() =>
      PRODUCT_GETS["content/versions"](ctx(otherPid, {}, `cid=${a.id}`)),
    );
    const r = {
      keyword: "tema",
      mine: {
        title: "Tema",
        meta: null,
        headings: [],
        schema: [],
        h1: [],
        words: 0,
      },
      sections: [],
      paa: [],
      terms: [],
      pageType: "article",
    } as unknown as ContentResult;
    const regenerated = await regenerateSection(r, brief, "titles", "es", "cl");
    assert.deepEqual(regenerated.outline, brief.outline);
    assert.deepEqual(regenerated.faq, brief.faq);
  },
);
test(
  "Exploraciones se guardan y no se accede desde otro proyecto",
  { skip: !enabled },
  async () => {
    const graph = {
      nodes: [
        {
          id: "a",
          position: { x: 1, y: 2 },
          data: { type: "keyword", label: "tema", key: "tema" },
        },
      ],
      edges: [],
    };
    const g: any = await PRODUCT_POSTS.explorations(
      ctx(pid, { name: "Mapa", graph }),
    );
    assert.equal(
      (
        (await PRODUCT_GETS["explorations/one"](
          ctx(pid, {}, `eid=${g.id}`),
        )) as any
      ).name,
      "Mapa",
    );
    await assert.rejects(() =>
      PRODUCT_GETS["explorations/one"](ctx(otherPid, {}, `eid=${g.id}`)),
    );
    await assert.rejects(() =>
      PRODUCT_POSTS.explorations(
        ctx(pid, {
          name: "Mal",
          graph: {
            ...graph,
            nodes: [
              { ...graph.nodes[0], data: { type: "invalid", label: "x" } },
            ],
          },
        }),
      ),
    );
  },
);
test(
  "Último cupo de informes es atómico y borrar un informe no devuelve uso mensual",
  { skip: !enabled },
  async () => {
    await db.workspace.update({ where: { id: wid }, data: { plan: "trial" } });
    await db.quotaUsage.deleteMany({ where: { workspaceId: wid } });
    await db.quotaUsage.create({
      data: { workspaceId: wid, resource: "reports", amount: 1 },
    });
    const results = await Promise.allSettled([
      saveReport(pid),
      saveReport(pid),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    await db.reportSnapshot.deleteMany({ where: { projectId: pid } });
    await assert.rejects(() => saveReport(pid), PlanLimitError);
    await db.workspace.update({ where: { id: wid }, data: { plan: "agency" } });
  },
);
test(
  "Límites de proyectos y white-label se aplican en servidor",
  { skip: !enabled },
  async () => {
    await db.workspace.update({ where: { id: wid }, data: { plan: "trial" } });
    await assert.rejects(
      () =>
        createProjectWithinPlan(wid, {
          workspaceId: wid,
          name: "Tercero",
          domain: "tercero.cl",
        }),
      PlanLimitError,
    );
    const plan: any = await PRODUCT_GETS.plan(ctx());
    assert.equal(plan.limits.whiteLabel, false);
    await db.workspace.update({ where: { id: wid }, data: { plan: "agency" } });
  },
);
test("Stripe: rechaza firma manipulada sin ninguna petición de red", () => {
  const prior = {
    key: process.env.STRIPE_SECRET_KEY,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  };
  process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_fixture";
  try {
    const payload = JSON.stringify({
      id: "evt_fixture",
      type: "checkout.session.completed",
      data: { object: {} },
    });
    const sig = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: "whsec_fixture",
    });
    assert.equal(verifyStripeEvent(payload, sig).id, "evt_fixture");
    assert.throws(() => verifyStripeEvent(payload + " ", sig));
  } finally {
    if (prior.key === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prior.key;
    if (prior.secret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prior.secret;
  }
});
test(
  "Stripe: dos notificaciones del mismo pago conceden un solo crédito",
  { skip: !enabled },
  async () => {
    const order = await db.billingOrder.create({
      data: {
        workspaceId: wid,
        product: "report",
        provider: "stripe",
        providerId: `cs_${suffix}`,
        amount: 5000,
        currency: "clp",
      },
    });
    const session = {
      id: order.providerId,
      payment_status: "paid",
      amount_total: 5000,
      currency: "clp",
      customer: `cus_${suffix}`,
      subscription: null,
      metadata: { orderId: order.id, workspaceId: wid },
    };
    const stripe = {
      checkout: { sessions: { retrieve: async () => session } },
    } as unknown as Stripe;
    const ev = {
      id: `evt_${suffix}_1`,
      type: "checkout.session.completed",
      data: { object: { id: order.providerId } },
    } as unknown as Stripe.Event;
    const before = (
      await db.workspace.findUniqueOrThrow({ where: { id: wid } })
    ).reportCredits;
    await Promise.all([
      handleStripeEvent(ev, stripe),
      handleStripeEvent({ ...ev, id: `evt_${suffix}_2` }, stripe),
    ]);
    assert.equal(
      (await db.workspace.findUniqueOrThrow({ where: { id: wid } }))
        .reportCredits,
      before + 1,
    );
    await assert.rejects(() =>
      handleStripeEvent({ ...ev, id: `evt_${suffix}_3` }, {
        checkout: {
          sessions: { retrieve: async () => ({ ...session, amount_total: 1 }) },
        },
      } as unknown as Stripe),
    );
  },
);

test(
  "Los trabajos de API atribuyen costos al JobRun y registran fallos",
  { skip: !enabled },
  async () => {
    let jobId: string | undefined;
    await runInlineJob(pid, "content.section", async () => {
      jobId = currentJobRunId();
      await logUsage({
        provider: "fixture",
        endpoint: "section",
        costUsd: 0.01,
      });
    });
    assert.ok(jobId);
    assert.equal(
      (await db.jobRun.findUniqueOrThrow({ where: { id: jobId } })).status,
      "done",
    );
    assert.equal(
      (await db.providerUsage.findFirstOrThrow({ where: { jobRunId: jobId } }))
        .projectId,
      pid,
    );
    await assert.rejects(() =>
      runInlineJob(pid, "content.rebrief", async () => {
        throw new Error("fixture: error esperado");
      }),
    );
    assert.equal(
      (
        await db.jobRun.findFirstOrThrow({
          where: { projectId: pid, kind: "content.rebrief" },
          orderBy: { createdAt: "desc" },
        })
      ).status,
      "error",
    );
  },
);

test("El brief rechaza estructuras incorrectas de IA o edición antes de guardarlas", () => {
  assert.throws(() => validateBrief({ ...brief, filters: "malformado" }));
  assert.throws(() =>
    validateBrief({ ...brief, links: [{ anchor: "Enlace", to: {} }] }),
  );
  assert.throws(() =>
    validateBrief({ ...brief, intro: { texto: "no válido" } }),
  );
  assert.doesNotThrow(() => validateBrief(brief));
});

test(
  "Auditorías existentes crean tareas y una nueva auditoría verifica la corrección; PDF incluye impacto y evidencia",
  { skip: !enabled },
  async () => {
    const project = await db.project.create({
      data: {
        workspaceId: wid,
        name: "Verificación",
        domain: "verificacion.cl",
      },
    });
    const url = "https://verificacion.cl/producto";
    const first = await db.crawl.create({
      data: {
        projectId: project.id,
        status: "completed",
        startedAt: new Date(Date.now() - 60000),
        finishedAt: new Date(),
        stats: { health: 80 },
        pages: { create: { url, status: 200 } },
        issues: {
          create: {
            url,
            code: "title_missing",
            severity: "warning",
            detail: "Título vacío en producto",
          },
        },
      },
    });
    assert.equal(
      await db.projectTask.count({ where: { projectId: project.id } }),
      0,
    );
    const initial = await projectActions(project.id);
    assert.equal(initial.tasks.length, 1);
    assert.equal(initial.tasks[0].lastCrawlId, first.id);
    assert.equal(initial.tasks[0].status, "detected");
    await assert.rejects(() => PRODUCT_PATCHS.tasks({ id: project.id, url: new URL("http://local/tasks"), body: { taskId: initial.tasks[0].id, status: "resolved" }, user: { id: "test", email: "test@example.test" } }), /Verifica la corrección/);
    await setTaskStatus(project.id, initial.tasks[0].id, "pending", "test");
    assert.equal((await projectActions(project.id)).tasks[0].status, "pending");
    const report = await executiveReport(project.id);
    assert.equal(report.findings[0].code, "title_missing");
    assert.equal(report.findings[0].count, 1);
    assert.deepEqual(report.findings[0].urls, [url]);
    assert.ok(report.findings[0].fix.length > 20);
    const executive = await executivePdf(report);
    const technical = await executivePdf(
      report,
      "# Evidencia técnica\n## Título ausente\nURL: " +
        url +
        "\nTítulo vacío en producto. Añadir un título descriptivo y único.",
    );
    assert.equal(technical.subarray(0, 5).toString(), "%PDF-");
    assert.ok(technical.length > executive.length);
    const second = await db.crawl.create({
      data: {
        projectId: project.id,
        status: "completed",
        startedAt: new Date(Date.now() + 1000),
        finishedAt: new Date(),
        stats: { health: 91 },
        pages: { create: { url, status: 200 } },
      },
    });
    const checked = await projectActions(project.id);
    assert.equal(checked.tasks[0].status, "resolved");
    assert.equal(checked.tasks[0].lastCrawlId, second.id);
    assert.ok(
      checked.tasks[0].events.some((e) =>
        e.note?.includes("volvió a rastrear"),
      ),
    );
  },
);
