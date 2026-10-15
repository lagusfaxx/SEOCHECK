/**
 * Resultados para marketing: KPIs con/sin marca, objetivo, efecto de anotaciones, caída sostenida y competidores.
 * Requiere DATABASE_URL (si no está, se omite).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const hasDb = Boolean(process.env.DATABASE_URL);
let projectId = "";
const S = "https://mi-sitio.cl";
const END = Date.UTC(2026, 8, 30); // último día con datos

before(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  const ws = await db.workspace.create({ data: { name: "test" } });
  projectId = (await db.project.create({ data: { workspaceId: ws.id, name: "m", domain: "mi-sitio.cl" } })).id;
  const day = (offset: number) => new Date(END - offset * 864e5);
  const days: any[] = [], rows: any[] = [];
  for (let i = 0; i < 84; i++) {
    // 10 clics/día antes del 2026-09-16 (cambio) y 15 después
    const c = i <= 13 ? 15 : 10;
    days.push({ projectId, date: day(i), clicks: c, impressions: 200, ctr: c / 200, position: 8 });
    rows.push({ projectId, date: day(i), query: "masajes providencia", page: `${S}/perfil/ana`, clicks: c - 2, impressions: 150, ctr: 0.05, position: 8 });
    rows.push({ projectId, date: day(i), query: "mi sitio", page: `${S}/`, clicks: 2, impressions: 10, ctr: 0.2, position: 1 });
    // página en caída: 3, 2, 1 clics/día en cada ventana de 28 días
    rows.push({ projectId, date: day(i), query: "spa viejo", page: `${S}/blog/viejo`, clicks: i < 28 ? 1 : i < 56 ? 2 : 3, impressions: 30, ctr: 0.05, position: 9 });
  }
  await db.gscDay.createMany({ data: days });
  await db.gscRow.createMany({ data: rows });
  await db.ga4Row.createMany({
    data: Array.from({ length: 56 }, (_, i) => ({ projectId, date: day(i), landing: "/perfil/ana", sessions: 20, keyEvents: i < 28 ? 2 : 1, revenue: i < 28 ? 10000 : 5000 })),
  });
  await db.annotation.create({ data: { projectId, date: new Date(END - 14 * 864e5), title: "Nuevos titles" } });
  await db.trackedKeyword.create({ data: { projectId, keyword: "masajes providencia" } });
  await db.serpSnapshot.create({
    data: {
      projectId, keyword: "masajes providencia", paa: [], related: [], features: [],
      organic: [{ position: 1, url: "https://rival.cl/x", domain: "rival.cl", title: "" }, { position: 8, url: `${S}/perfil/ana`, domain: "mi-sitio.cl", title: "" }],
      aiOverview: { references: [{ link: "https://rival.cl/x" }] },
    },
  });
});

after(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  await db.project.deleteMany({ where: { id: projectId } });
  await db.$disconnect();
});

test("resultados: KPIs con y sin marca, objetivo, efecto de un cambio, caída y competidores", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  const { marketingOverview } = await import("./marketing");
  await db.project.update({ where: { id: projectId }, data: { settings: { marketing: { goals: { clicks: 600 } }, ga4: { property: "properties/1", displayName: "Mi sitio", currency: "CLP" } } } });
  const r = await marketingOverview(projectId);
  assert.ok(r.connected);
  if (!r.connected) return;
  assert.equal(r.kpis!.period.end, "2026-09-30");
  assert.equal(r.kpis!.clicks.now, 14 * 15 + 14 * 10);
  assert.equal(r.kpis!.brand.now, 28 * 2);
  assert.ok(r.kpis!.nonBrand.now > r.kpis!.brand.now);
  // objetivo: 30 días de septiembre con datos
  assert.equal(r.goalProgress!.clicks.daysWithData, 30);
  assert.equal(r.goalProgress!.clicks.target, 600);
  // la anotación del 16-09 compara 14 días a cada lado (sin contar el día del cambio): 10 → 15 clics/día
  const a = r.annotations.find((x) => x.title === "Nuevos titles")!;
  assert.equal(a.impact!.beforePerDay, 10);
  assert.equal(a.impact!.afterPerDay, 15);
  assert.equal(a.impact!.conclusive, true);
  assert.deepEqual(r.decay!.map((d) => d.page), [`${S}/blog/viejo`]);
  assert.ok(r.opportunities!.rows.some((o) => o.query === "masajes providencia"));
  assert.equal(r.competitors!.top[0].domain, "rival.cl");
  assert.equal(r.competitors!.aiOverview.keywords, 1);
  assert.equal(r.competitors!.aiOverview.cited, 0);
  // GA4 en las mismas fechas que Search Console
  const g = r.ga4!;
  assert.ok(g && !g.empty);
  if (g && !g.empty) {
    assert.equal(g.period.end, "2026-09-30");
    assert.equal(g.current.keyEvents, 56);
    assert.equal(g.previous.keyEvents, 28);
    assert.equal(g.landings[0].landing, "/perfil/ana");
    assert.equal(g.landings[0].conversionRate, 0.1);
  }
});
