import { test } from "node:test";
import assert from "node:assert/strict";
import { beforeAfter, citedInAiOverview, inScope, isDecaying, monthPace, opportunityClicks, shareOfVoice } from "./marketing";

test("ritmo del mes: proyección lineal, estado y clics/día que faltan", () => {
  const p = monthPace(300, 10, 30, 1200);
  assert.equal(p.projected, 900);
  assert.equal(p.status, "bajo el ritmo");
  assert.equal(p.needPerDay, 45); // (1200-300)/20
  assert.equal(monthPace(400, 10, 30, 1200).status, "en ritmo");
  assert.equal(monthPace(100, 10, 30, null).status, null);
});

test("antes/después: por día, y no concluye con poca ventana o pocos clics", () => {
  const r = beforeAfter({ clicks: 280, impressions: 2800, days: 28 }, { clicks: 420, impressions: 3000, days: 28 });
  assert.equal(r.beforePerDay, 10);
  assert.equal(r.afterPerDay, 15);
  assert.equal(Math.round(r.change! * 100), 50);
  assert.equal(r.conclusive, true);
  assert.equal(beforeAfter({ clicks: 50, impressions: 0, days: 7 }, { clicks: 60, impressions: 0, days: 7 }).conclusive, false);
  assert.equal(beforeAfter({ clicks: 5, impressions: 0, days: 28 }, { clicks: 8, impressions: 0, days: 28 }).conclusive, false);
});

test("caída sostenida: tres bajadas seguidas y ≥ 30 %", () => {
  assert.ok(isDecaying(100, 80, 60));
  assert.ok(!isDecaying(100, 60, 80), "rebote no es caída sostenida");
  assert.ok(!isDecaying(100, 90, 80), "menos de 30 %");
  assert.ok(!isDecaying(5, 3, 1), "muy pocos clics");
});

test("clics extra hasta la posición 3", () => {
  assert.equal(opportunityClicks(1000, 20, 8), 80); // 1000 × 10 % − 20
  assert.equal(opportunityClicks(1000, 20, 2), 0);
});

test("cuota de visibilidad por dominio, ponderada por volumen y posición", () => {
  const s = shareOfVoice(
    [
      { keyword: "a", volume: 1000, results: [{ domain: "www.rival.cl", position: 1 }, { domain: "mio.cl", position: 5 }] },
      { keyword: "b", volume: 100, results: [{ domain: "mio.cl", position: 1 }, { domain: "rival.cl", position: 2 }] },
    ],
    "mio.cl"
  );
  assert.equal(s.rows[0].domain, "rival.cl");
  assert.ok(s.ownShare > 0 && s.ownShare < 0.5);
  assert.equal(s.rows.find((r) => r.own)?.keywords, 2);
});

test("alcance de anotaciones y citas en AI Overview", () => {
  assert.ok(inScope("https://x.cl/blog/nota", "/blog/*"));
  assert.ok(!inScope("https://x.cl/perfil/ana", "/blog/*"));
  assert.ok(inScope("https://x.cl/lineas/", "/lineas"));
  assert.ok(inScope("https://x.cl/a", "https://x.cl/a"));
  assert.ok(inScope("https://x.cl/a", null));
  assert.ok(citedInAiOverview({ references: [{ link: "https://www.mio.cl/guia" }] }, "mio.cl"));
  assert.ok(!citedInAiOverview(null, "mio.cl"));
});

import { digestParagraphs } from "./digest";

test("resumen por correo: clics sin marca, objetivo, efecto concluyente y próximas acciones", () => {
  const pace = { mtd: 300, projected: 900, target: 1200, status: "bajo el ritmo", needPerDay: 45, daysWithData: 10, daysInMonth: 30 };
  const lines = digestParagraphs(
    {
      connected: true,
      kpis: { period: { start: "2026-09-03", end: "2026-09-30", label: "" }, clicks: { now: 1200, before: 1000 }, impressions: { now: 0, before: 0 }, brand: { now: 200, before: 200 }, nonBrand: { now: 1000, before: 800 }, nonBrandImpressions: { now: 0, before: 0 }, source: "" },
      sections: [], goals: {}, goalProgress: { month: "2026-09", clicks: pace, nonBrandClicks: { ...pace, target: null } },
      annotations: [
        { id: "a", kind: "manual", date: "2026-09-01", title: "Nuevos titles", scope: null, note: null, impact: { beforePerDay: 10, afterPerDay: 15, change: 0.5, conclusive: true, note: "", impressionsBeforePerDay: 0, impressionsAfterPerDay: 0 } },
        { id: "b", kind: "manual", date: "2026-09-28", title: "Reciente", scope: null, note: null, impact: { beforePerDay: 10, afterPerDay: 30, change: 2, conclusive: false, note: "", impressionsBeforePerDay: 0, impressionsAfterPerDay: 0 } },
      ],
      decay: [], opportunities: { rows: [], extraClicks: 120, note: "" }, competitors: null,
    } as any,
    [{ title: "Error 4xx · /viejo" }]
  ).join("\n");
  assert.match(lines, /Sin marca: 1\.000 \(\+25 %/);
  assert.match(lines, /Objetivo 2026-09: 300 de 1\.200 clics, proyección 900 \(bajo el ritmo\)/);
  assert.match(lines, /Nuevos titles.*10 → 15 clics\/día \(\+50 %\)/);
  assert.doesNotMatch(lines, /Reciente/, "lo no concluyente no se reporta como resultado");
  assert.match(lines, /1\) Error 4xx/);
});
