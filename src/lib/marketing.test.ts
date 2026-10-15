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
