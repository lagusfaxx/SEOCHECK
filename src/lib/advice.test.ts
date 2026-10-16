import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  buildPlan,
  profileOf,
  type Input,
  type AdvicePage,
} from "./advice/plan";
import {
  applySuggestions,
  validateSuggestions,
  promptFor,
  ADVICE_SCHEMA,
} from "./advice/ai";
import { explainPlan, fingerprint } from "./advice/service";
import { fieldCls, vitalStatus } from "./web-vitals";
import { parsePsi } from "./providers/google";
import { psiVerdict } from "./report-rules";
import {
  visibleColumns,
  displayValue,
  MODULE_HELP,
} from "./advice/presentation";
const page = (template = "product"): AdvicePage => ({
  url: "https://taupoc.cl/producto/taza",
  template,
  status: 200,
  noindex: false,
  blocked: false,
  error: null,
  title: "Taza",
  h1: ["Taza"],
  canonicalType: "self",
  commerce: { availability: "OutOfStock" },
  structured: { jsonld: [{ type: "Offer", props: { price: 1000 } }] },
  wordCount: 70,
  inlinks: 3,
});
const group = (
  id: string,
  code = "http_4xx",
  severity = "critical",
  status = "detected",
) => ({
  id,
  title: "Error técnico",
  code,
  reason: "Se detectó el problema",
  fix: "Revisar la página",
  priorityLabel:
    severity === "critical"
      ? "Alta"
      : severity === "warning"
        ? "Media"
        : "Baja",
  priority: severity === "critical" ? 300 : 10,
  severity,
  affected: 3,
  pattern: "/productos/*",
  members: [
    {
      id,
      title: "Error técnico",
      code,
      reason: "HTTP 404 observado en la auditoría",
      source: "crawl",
      severity,
      priority: 10,
      status,
      url: "https://taupoc.cl/producto/taza",
    },
  ],
});
const input = (props: Partial<Input> = {}): Input => ({
  pages: [page()],
  groups: [group("task-1")],
  crawlAt: "2026-10-16T00:00:00Z",
  partial: false,
  gsc: true,
  analytics: true,
  performance: true,
  period: "2026-09-18 a 2026-10-15",
  ...props,
});
const valid = (plan = buildPlan(input())) => ({
  recommendations: [
    {
      id: plan.actions[0].id,
      explanation:
        "La página revisada responde con un error. Comprueba su destino.",
      steps: ["Abre la página y revisa su contenido."],
      verify: "Vuelve a ejecutar la auditoría.",
      evidenceIds: [plan.actions[0].evidence[0].id],
    },
  ],
});

test("perfil: tipo y objetivo válidos sin suponer que todo sitio es tienda", () => {
  assert.deepEqual(
    profileOf({ siteType: "inventado", goal: "imposible", aiEnabled: false }),
    { siteType: "auto", goal: "visibility", aiEnabled: false },
  );
  assert.equal(buildPlan(input()).effectiveType, "ecommerce");
  assert.equal(
    buildPlan(input({ pages: [page("other")] })).effectiveType,
    "general",
  );
});
test("tienda: fichas, variantes y políticas se revisan sin certificar checkout", () => {
  const p = buildPlan(input({ profile: { goal: "sales" } }));
  assert.equal(p.goalLabel, "Aumentar ventas orgánicas");
  assert.ok(
    p.checks.some((c) => c.key === "products" && c.status === "available"),
  );
  assert.equal(p.checks.find((c) => c.key === "trust")?.status, "review");
  assert.match(p.checks.find((c) => c.key === "trust")!.detail, /manual/);
});
test("servicios: prioriza contactos y no añade tareas de catálogo", () => {
  const p = buildPlan(
    input({ profile: { siteType: "services", goal: "leads" } }),
  );
  assert.ok(p.checks.some((c) => c.key === "leads"));
  assert.ok(!p.checks.some((c) => c.key === "products"));
  assert.equal(p.goalLabel, "Conseguir consultas o contactos");
});
test("contenidos: revisa autoría y vigencia sin objetivos de palabras", () => {
  const p = buildPlan(input({ pages: [page("article")] }));
  assert.equal(p.effectiveType, "content");
  assert.ok(p.checks.some((c) => c.key === "editorial"));
  assert.match(
    p.checks.find((c) => c.key === "content")!.detail,
    /Ninguna cantidad fija/,
  );
});
test("sin datos no se presenta una certificación ni acciones inventadas", () => {
  const p = buildPlan(
    input({
      pages: [],
      groups: [],
      crawlAt: null,
      gsc: false,
      analytics: false,
      performance: false,
    }),
  );
  assert.equal(p.actions.length, 0);
  assert.equal(p.checks.filter((c) => c.status === "available").length, 0);
  assert.match(
    p.checks.find((c) => c.key === "crawl")!.detail,
    /no hay una auditoría/,
  );
});
test("auditoría parcial mantiene la incertidumbre sobre huérfanas", () => {
  const p = buildPlan(
    input({ partial: true, groups: [group("orphan", "orphan", "warning")] }),
  );
  assert.equal(p.actions[0].confidence, "hipótesis");
  assert.match(p.actions[0].verify, /cobertura/);
  assert.ok(p.notes.some((n) => n.includes("parcial")));
});
test("prioriza errores observados sobre observaciones aunque el orden de entrada cambie", () => {
  const p = buildPlan(
    input({
      groups: [group("stock", "product_out_of_stock", "info"), group("error")],
    }),
  );
  assert.equal(p.actions[0].taskId, "error");
  assert.equal(p.actions[0].title, "Recuperar las páginas que ya no abren");
  assert.equal(p.actions[0].affected, 3);
});
test("las tareas resueltas o ignoradas no generan próximas acciones", () => {
  const p = buildPlan(
    input({
      groups: [
        group("r", "http_4xx", "critical", "resolved"),
        group("i", "http_4xx", "critical", "ignored"),
      ],
    }),
  );
  assert.equal(p.actions.length, 0);
});
test("IA: añade explicaciones sin borrar acciones ni cambiar prioridades, confianza o evidencia", () => {
  const plan = buildPlan(
      input({ groups: [group("a"), group("b", "orphan", "warning")] }),
    ),
    before = JSON.stringify(plan);
  const suggestions = validateSuggestions(valid(plan), plan),
    out = applySuggestions(plan, suggestions);
  assert.equal(out.actions.length, 2);
  assert.equal(out.actions[0].priority, plan.actions[0].priority);
  assert.deepEqual(out.actions[0].evidence, plan.actions[0].evidence);
  assert.ok(out.actions[0].ai);
  assert.equal(out.actions[1].ai, undefined);
  assert.equal(JSON.stringify(plan), before);
});
test("IA: rechaza acciones desconocidas y duplicadas", () => {
  const plan = buildPlan(input()),
    raw = valid(plan);
  raw.recommendations[0].id = "otra";
  assert.throws(() => validateSuggestions(raw, plan), /desconocida/);
  const duplicate = valid(plan);
  duplicate.recommendations.push({ ...duplicate.recommendations[0] });
  assert.throws(() => validateSuggestions(duplicate, plan), /duplicada/);
});
test("IA: las referencias deben pertenecer a la acción explicada", () => {
  const plan = buildPlan(
      input({ groups: [group("a"), group("b", "orphan", "warning")] }),
    ),
    raw = valid(plan);
  raw.recommendations[0].evidenceIds = [plan.actions[1].evidence[0].id];
  assert.throws(() => validateSuggestions(raw, plan), /evidencia/);
});
test("IA: rechaza cifras inventadas, enlaces, correos y garantías", () => {
  const plan = buildPlan(input());
  for (const text of [
    "Aumentará ventas 999999%",
    "Ve a https://evil.invalid",
    "Contacta persona@example.com",
    "Garantizamos posiciones",
  ]) {
    const raw = valid(plan);
    raw.recommendations[0].explanation = text;
    assert.throws(() => validateSuggestions(raw, plan));
  }
});
test("IA: omite consultas y correos en la evidencia enviada al modelo", () => {
  const plan = buildPlan(input());
  plan.actions[0].evidence[0].observation =
    "Revisar https://taupoc.cl/a?token=secret para user@example.com";
  plan.actions[0].title = "Revisar user@example.com";
  plan.actions[0].why = "Revisar https://taupoc.cl/a?token=secret";
  plan.actions[0].steps = ["Consultar user@example.com"];
  plan.actions[0].verify = "Revisar https://taupoc.cl/a?token=secret";
  const prompt = promptFor(plan);
  assert.ok(!prompt.includes("token=secret"));
  assert.ok(!prompt.includes("user@example.com"));
  assert.ok(prompt.includes("https://taupoc.cl/a"));
});
test("IA: pipeline solicita esquema y valida la respuesta con un proveedor simulado", async () => {
  const plan = buildPlan(input());
  let received: any;
  const provider = {
    json: async (...args: any[]) => {
      received = args;
      return valid(plan);
    },
  };
  const result = await explainPlan(plan, provider as any);
  assert.equal(result.length, 1);
  assert.equal(received[4], ADVICE_SCHEMA);
  assert.equal(received[2], 3000);
  const invalid = {
    json: async () => ({ recommendations: [{ id: "inexistente" }] }),
  };
  await assert.rejects(() => explainPlan(plan, invalid as any));
});
test("cache: cambia con la evidencia y no solo con el texto de la explicación", () => {
  const plan = buildPlan(input()),
    first = fingerprint(plan);
  assert.equal(first, fingerprint(structuredClone(plan)));
  plan.actions[0].evidence[0].observation = "HTTP 500";
  assert.notEqual(first, fingerprint(plan));
});
test("OpenAI: envía JSON Schema estricto al pedir explicaciones y conserva JSON mode en las llamadas normales", async () => {
  let captured: any;
  const srv = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      captured = JSON.parse(raw);
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          choices: [{ message: { content: '{"recommendations":[]}' } }],
          usage: {},
        }),
      );
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  try {
    const { OpenAILLM } = await import("./providers/llm");
    const out = await new OpenAILLM(
      `http://127.0.0.1:${(srv.address() as any).port}`,
    ).json("system", "user", 200, "low", ADVICE_SCHEMA);
    assert.deepEqual(out, { recommendations: [] });
    assert.equal(captured.response_format.type, "json_schema");
    assert.equal(captured.response_format.json_schema.strict, true);
    assert.deepEqual(
      captured.response_format.json_schema.schema,
      ADVICE_SCHEMA.schema,
    );
  } finally {
    await new Promise<void>((r) => srv.close(() => r()));
  }
});
test("CLS: PageSpeed normaliza centésimas y las filas históricas se interpretan igual", () => {
  const p = parsePsi({
    loadingExperience: {
      metrics: {
        CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5, category: "FAST" },
      },
    },
  });
  assert.equal(p.field.cls?.p75, 0.05);
  assert.equal(fieldCls(p.field), 0.05);
  assert.equal(fieldCls({ cls: { p75: 5 } }), 0.05);
  assert.equal(fieldCls({ cls: { p75: 0 } }), 0);
  assert.equal(fieldCls({ cls: null }), null);
  assert.equal(psiVerdict(90, {}, p.field).fieldBad, false);
});
test("Core Web Vitals: clasifica límites sin convertir datos faltantes en buenos", () => {
  assert.equal(vitalStatus("lcp", 2500), "Bueno");
  assert.equal(vitalStatus("inp", 201), "Necesita mejora");
  assert.equal(vitalStatus("cls", 0.26), "Deficiente");
  assert.equal(vitalStatus("cls", null), "Sin datos");
  assert.equal(
    psiVerdict(90, {}, { source: "url", cls: { p75: 26, cat: null } }).fieldBad,
    true,
  );
});
test("vista guiada conserva columnas útiles y vista técnica permite consultar todas", () => {
  const keys = [
    "url",
    "lcpCampo",
    "inpCampo",
    "clsCampo",
    "lcpLaboratorio",
    "tbtLaboratorio",
    "id",
  ];
  assert.ok(!visibleColumns("perf", keys, "guided").includes("tbtLaboratorio"));
  assert.ok(
    visibleColumns("perf", keys, "technical").includes("tbtLaboratorio"),
  );
  assert.ok(!visibleColumns("perf", keys, "technical").includes("id"));
});
test("presentación: cero no se confunde con sin datos y explica términos de SERP", () => {
  assert.equal(displayValue("clsCampo", 0), "0");
  assert.equal(displayValue("clsCampo", null), "Sin datos");
  assert.equal(displayValue("plantilla", "product"), "Ficha de producto");
  assert.equal(
    displayValue("features", "snippet, paa"),
    "Respuesta destacada, Otras preguntas",
  );
  assert.match(MODULE_HELP.index.empty, /Sin inspección/);
});

test("campo parcial: una métrica buena no demuestra que los tres Web Vitals estén bien", () => {
  const v = psiVerdict(
    30,
    { lcp: 6000 },
    { source: "url", lcp: { p75: 1900, cat: "FAST" } },
  );
  assert.equal(v.hasField, true);
  assert.equal(v.fieldComplete, false);
  assert.equal(v.fieldBad, false);
  assert.equal(v.actionable, true);
});
test("la evidencia manual usa su propia fecha, sin atribuirle la fecha del crawl", () => {
  const g = group("manual");
  g.members[0].source = "manual";
  const p = buildPlan(input({ groups: [g] }));
  assert.equal(p.actions[0].evidence[0].at, "");
  assert.equal(p.actions[0].confidence, "revisión manual");
});
