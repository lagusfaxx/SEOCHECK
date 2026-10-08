/**
 * Informe completo: datos sembrados en Postgres → Markdown; y el job "correr todo" con pasos saltados.
 * Requiere DATABASE_URL (si no está, se omite).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const hasDb = Boolean(process.env.DATABASE_URL);
let projectId = "";
const S = "https://mi-sitio.cl";

before(async () => {
  if (!hasDb) return;
  delete process.env.PAGESPEED_API_KEY;
  delete process.env.GSC_SERVICE_ACCOUNT_JSON;
  const { db } = await import("./db");
  const ws = await db.workspace.create({ data: { name: "test" } });
  const p = await db.project.create({ data: { workspaceId: ws.id, name: "r", domain: "mi-sitio.cl" } });
  projectId = p.id;

  // crawl que tocó el límite (2 páginas por links), con huérfanas
  const crawl = await db.crawl.create({
    data: {
      projectId,
      status: "completed",
      options: { maxPages: 2 },
      stats: { health: 80, pages: 4, errors: 1, redirects: 0, orphans: 2, sitemap: 4, avgMs: 120, critical: 1, warning: 3, info: 0 },
    },
  });
  await db.page.createMany({
    data: [
      { crawlId: crawl.id, url: `${S}/`, status: 200, depth: 0, inlinks: 0, outlinks: 30 },
      { crawlId: crawl.id, url: `${S}/perfil/ana`, status: 200, depth: 1, inlinks: 5 },
      { crawlId: crawl.id, url: `${S}/perfil/bea`, status: 200, depth: 1, inlinks: 5 },
      { crawlId: crawl.id, url: `${S}/blog/post`, status: 200, depth: 1, inlinks: 1 },
    ],
  });
  await db.issue.createMany({
    data: [
      { crawlId: crawl.id, url: `${S}/perfil/ana`, code: "title_long", severity: "warning", detail: "78" },
      { crawlId: crawl.id, url: `${S}/perfil/bea`, code: "title_long", severity: "warning", detail: "81" },
      { crawlId: crawl.id, url: `${S}/blog/post`, code: "img_no_alt", severity: "info", detail: "2" },
      { crawlId: crawl.id, url: `${S}/viejo`, code: "http_4xx", severity: "critical", detail: "404" },
      { crawlId: crawl.id, url: `${S}/perfil/zoe`, code: "orphan", severity: "warning" },
      // falsos positivos
      { crawlId: crawl.id, url: `${S}/perfil/ana?orden=precio`, code: "canonical_other", severity: "info", detail: `${S}/perfil/ana` },
      { crawlId: crawl.id, url: `${S}/login`, code: "blocked_robots", severity: "info" },
      { crawlId: crawl.id, url: `${S}/mi-cuenta/pedidos`, code: "blocked_robots", severity: "info" },
    ],
  });

  const day = (n: number) => new Date(Date.UTC(2026, 8, n));
  const prevDay = new Date(Date.UTC(2026, 7, 10)); // dentro de los 28 días anteriores
  const row = (d: number | Date, query: string, page: string, clicks: number, impressions: number, position: number) => ({ projectId, date: typeof d === "number" ? day(d) : d, query, page, clicks, impressions, ctr: clicks / impressions, position });
  await db.gscRow.createMany({
    data: [
      // oportunidades 4–20 en /perfil/*
      row(20, "masajes providencia", `${S}/perfil/ana`, 3, 400, 8.2),
      row(20, "masajista providencia", `${S}/perfil/ana`, 1, 150, 11),
      // variantes ortográficas a la misma página
      row(20, "masajes penalolen", `${S}/perfil/bea`, 2, 300, 6),
      row(20, "masajes peñalolen", `${S}/perfil/bea`, 1, 120, 7),
      // CTR bajo en top 10 (pos 2, 1% CTR vs ~15% esperado)
      row(21, "spa santiago", `${S}/blog/post`, 5, 500, 2.1),
      // marca
      row(21, "mi sitio", `${S}/`, 90, 300, 1.1),
      // período anterior (tendencia)
      row(prevDay, "spa santiago", `${S}/blog/post`, 20, 300, 3),
    ],
  });
  await db.gscDay.createMany({
    data: [
      { projectId, date: day(20), clicks: 60, impressions: 1200, ctr: 0.05, position: 7 },
      { projectId, date: day(21), clicks: 50, impressions: 900, ctr: 0.055, position: 3 },
      { projectId, date: prevDay, clicks: 100, impressions: 1000, ctr: 0.1, position: 4 },
    ],
  });

  // PageSpeed: laboratorio malo pero usuarios reales bien (interstitial típico)
  await db.psiResult.create({
    data: { projectId, url: `${S}/perfil/ana`, strategy: "mobile", score: 31, lab: { lcp: 9000 }, field: { source: "url", lcp: { p75: 1900, cat: "FAST" }, inp: { p75: 120, cat: "FAST" }, cls: { p75: 0.02, cat: "FAST" } } },
  });
  // PageSpeed móvil < 50 sin datos de campo: va arriba
  await db.psiResult.create({ data: { projectId, url: `${S}/blog/post`, strategy: "mobile", score: 22, lab: { lcp: 7000 }, field: { source: null } } });

  // canibalización: una de marca (intencional), una real
  await db.alert.createMany({
    data: [
      { projectId, type: "cannibal", key: "mi sitio chile", data: { source: "gsc", pages: [{ page: `${S}/`, impressions: 100, position: 1.2 }, { page: `${S}/blog/post`, impressions: 30, position: 4 }] } },
      { projectId, type: "cannibal", key: "masajes", data: { source: "gsc", pages: [{ page: `${S}/perfil/ana`, impressions: 200, position: 9 }, { page: `${S}/perfil/bea`, impressions: 180, position: 12 }] } },
      { projectId, type: "cannibal", key: "spa", data: { source: "gsc", pages: [{ page: `${S}/`, impressions: 50, position: 1 }, { page: `${S}/blog/post`, impressions: 40, position: 1.4 }] } },
    ],
  });

  const run = await db.keywordRun.create({ data: { projectId, seeds: ["masajes"], status: "done" } });
  await db.cluster.createMany({
    data: [
      { projectId, runId: run.id, name: "masajes las condes", primary: "masajes las condes", volume: 900, score: 9, urls: ["https://otro.cl/a"] },
      { projectId, runId: run.id, name: "masajes providencia", primary: "masajes providencia", volume: 500, score: 8, urls: ["https://www.mi-sitio.cl/perfil/ana"] },
    ],
  });
  await db.contentAnalysis.create({
    data: {
      projectId, url: `${S}/perfil/ana`, keyword: "masajes providencia", status: "done", score: 45,
      result: { pageType: "listing", mine: { editorial: 40, type: "detail" }, targetWords: 120, terms: [{ term: "las condes", missing: true }], paa: [] },
      brief: { kind: "listing", titles: ["Masajes en Providencia | Mi-sitio"], intro: "Intro corta", filters: ["comuna"], outline: [], faq: [] },
    },
  });
});

after(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  await db.project.deleteMany({ where: { id: projectId } });
  await db.$disconnect();
});

test("informe: priorización por impacto, falsos positivos, tendencias, GSC agrupado, PSI lab vs campo", { skip: !hasDb }, async () => {
  const { buildReport } = await import("./report");
  const md = await buildReport(projectId);
  if (process.env.REPORT_DUMP) (await import("node:fs")).writeFileSync(process.env.REPORT_DUMP, md);
  const sec = (h: string) => {
    const i = md.indexOf(`## ${h}`);
    assert.ok(i >= 0, `falta la sección ${h}`);
    const j = md.indexOf("\n## ", i + 3);
    return md.slice(i, j < 0 ? undefined : j);
  };
  assert.match(md, /^# Informe SEO · mi-sitio\.cl/);

  // 7. tendencias arriba, en %
  assert.ok(md.indexOf("## Tendencias") < md.indexOf("## Tareas por impacto"));
  assert.match(sec("Tendencias"), /\*\*Clics:\*\* 110 \(\+10,0 %\)/);
  assert.match(sec("Tendencias"), /\*\*Impresiones:\*\* 2\.100 \(\+110,0 %\)/);

  const tasks = sec("Tareas por impacto");
  const lines = tasks.split("\n").filter((l) => /^\d+\. /.test(l));
  const idx = (re: RegExp) => lines.findIndex((l) => re.test(l));
  // 1. oportunidades 4–20 y PageSpeed móvil < 50 por encima de issues on-page menores
  assert.ok(idx(/Subir posiciones 4–20 en `\/perfil\/\*`/) >= 0);
  assert.ok(idx(/Velocidad móvil de la plantilla `\/blog\/\*` \(laboratorio 22\/100 \(sin datos de campo\)/) >= 0);
  assert.ok(idx(/Subir posiciones/) < idx(/Imágenes sin alt/));
  assert.ok(idx(/Velocidad móvil de la plantilla `\/blog\/\*`/) < idx(/Imágenes sin alt/));
  // aunque "Title largo" afecte más impresiones, es on-page menor: va después
  assert.ok(idx(/Subir posiciones/) < idx(/Title largo/));
  assert.ok(idx(/Velocidad móvil de la plantilla `\/blog\/\*`/) < idx(/Title largo/));
  assert.match(tasks, /_Impacto [\d.]+ = [\d.]+ impr × /);
  // 6. agrupado por plantilla con cambio concreto
  assert.match(tasks, /incluir «masajes providencia» en el title y el H1/);
  // 8. CTR bajo por posición → title/meta de la plantilla
  assert.match(tasks, /CTR bajo en `\/blog\/\*`/);
  // 5. variantes ortográficas
  assert.match(tasks, /Cubrir variantes de escritura en `\/perfil\/\*`.*«masajes peñalolen»/);
  // 2. límite de páginas: huérfanas solo como aviso
  assert.doesNotMatch(tasks, /Huérfana/);
  assert.match(sec("Avisos"), /llegó al límite de 2 páginas: 1 URL del sitemap no se alcanzaron.*No se generan tareas de huérfanas/);
  // 3. falsos positivos
  assert.doesNotMatch(tasks, /Canonical a otra URL|Bloqueada por robots/);
  const ok = sec("Revisado, parece intencional");
  assert.match(ok, /Canonical a otra URL\*\* en 1 URL con parámetros/);
  assert.match(ok, /Bloqueadas por robots\*\* 2 URLs/);
  assert.match(ok, /«mi sitio chile» \(consulta de marca\)/);
  assert.match(ok, /«spa» \(todas las URLs en posición ≤ 1,5\)/);
  assert.match(tasks, /Canibalización en 1 consulta\b/);
  // 4. PSI: discrepancia lab vs campo marcada y sin tarea alta para esa URL
  const psi = sec("Velocidad (PageSpeed)");
  assert.match(psi, /LCP laboratorio 9\.000 ms vs usuarios reales 1\.900 ms\..*interstitial o modal/);
  assert.match(tasks, /Velocidad móvil de la plantilla `\/perfil\/\*` \(laboratorio 31\/100 pero los usuarios reales están bien\)[\s\S]*?× bajo ×/);
  // C7. contenido priorizado como cualquier tarea
  assert.match(tasks, /Contenido de https:\/\/mi-sitio\.cl\/perfil\/ana para «masajes providencia» \(score 45\/100\).*listado: intro corta/);
  // por impacto descendente dentro de cada grupo (importantes, después on-page menores)
  const meta = lines.map((l) => {
    const m = /_Impacto ([\d.]+) = [^_]*?(· on-page menor)?_/.exec(tasks.slice(tasks.indexOf(l)))!;
    return { score: Number(m[1].replace(/\./g, "")), minor: Boolean(m[2]) };
  });
  for (let i = 1; i < meta.length; i++) {
    assert.ok(Number(meta[i - 1].minor) <= Number(meta[i].minor), "los menores van al final");
    if (meta[i - 1].minor === meta[i].minor) assert.ok(meta[i - 1].score >= meta[i].score, `orden: ${meta.map((x) => x.score).join(",")}`);
  }
  // consultas de marca marcadas
  assert.match(sec("Search Console"), /\| mi sitio \| 90 \| 300 \| 1\.1 \| sí \|/);
});

test("correr todo: sigue aunque un paso falle y salta lo que no tiene credenciales", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  await db.project.update({ where: { id: projectId }, data: { domain: "localhost" } });
  const { runFull } = await import("./fullrun");
  const steps = await runFull(projectId, { maxPages: 5 });
  const by = Object.fromEntries(steps.map((s) => [s.step, s]));
  assert.deepEqual(Object.keys(by), ["crawl", "gsc", "inspect", "psi", "keywords", "rank", "alerts"]);
  // localhost no es accesible: el crawl queda fallido con motivo, sin puntaje, y el resto sigue
  assert.equal(by.crawl.status, "error");
  assert.match(by.crawl.detail ?? "", /No se pudo acceder al sitio: bloqueado por seguridad: host bloqueado: localhost/);
  const c = await db.crawl.findFirstOrThrow({ where: { projectId }, orderBy: { startedAt: "desc" } });
  assert.equal(c.status, "failed");
  assert.equal((c.stats as any).health, null);
  assert.equal(by.gsc.status, "skipped");
  assert.equal(by.psi.detail, "falta PAGESPEED_API_KEY");
  assert.equal(by.keywords.detail, "sin semillas");
  assert.equal(by.rank.detail, "sin keywords trackeadas");
  assert.equal(by.alerts.status, "ok");
  await db.project.update({ where: { id: projectId }, data: { domain: "mi-sitio.cl" } });
});
