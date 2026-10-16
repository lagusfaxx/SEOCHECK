/** Backlinks con DataForSEO simulado: foto del sitio y competidores, reuso semanal, informe y tareas. Requiere DATABASE_URL. */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const hasDb = Boolean(process.env.DATABASE_URL);
const hits: { path: string; body: any }[] = [];
let srv: http.Server;
let projectId = "";

before(async () => {
  if (!hasDb) return;
  srv = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const path = new URL(req.url!, "http://x").pathname;
      const task = JSON.parse(raw)[0];
      hits.push({ path, body: task });
      const ok = (result: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ cost: 0.02, tasks: [{ status_code: 20000, result: [result] }] }));
      if (path === "/v3/backlinks/summary/live")
        return ok(task.target === "mi-tienda.cl" ? { backlinks: 120, referring_domains: 30, rank: 210, broken_backlinks: 2, referring_domains_nofollow: 5 } : { backlinks: 900, referring_domains: 140, rank: 380, broken_backlinks: 0 });
      if (path === "/v3/backlinks/referring_domains/live")
        return ok({ items: task.backlinks_status_type === "lost" ? [{ domain: "viejo.cl", rank: 90, backlinks: 1, lost_date: "2026-09-20 00:00:00 +00:00" }] : [{ domain: "prensa.cl", rank: 400, backlinks: 3, first_seen: new Date(Date.now() - 5 * 864e5).toISOString().replace("T", " ").slice(0, 19) + " +00:00" }, { domain: "blog.cl", rank: 100, backlinks: 2, first_seen: "2024-01-01 00:00:00 +00:00" }] });
      if (path === "/v3/backlinks/backlinks/live")
        return ok({ items: [{ url_from: "https://prensa.cl/nota", url_to: "https://mi-tienda.cl/producto-viejo", url_to_status_code: 404, domain_from_rank: 400, dofollow: true, anchor: "traje" }] });
      if (path === "/v3/backlinks/domain_intersection/live")
        return ok({ items: [{ domain_intersection: { "1": { target: "federacion.cl", rank: 500 } }, summary: { intersections_count: 1 } }] });
      if (path === "/v3/dataforseo_labs/google/domain_intersection/live")
        return ok({ items: [{ keyword_data: { keyword: "trajes de competicion", keyword_info: { search_volume: 880, monthly_searches: Array.from({ length: 12 }, (_, i) => ({ year: 2026, month: i + 1, search_volume: i === 0 ? 2000 : 500 })) } }, first_domain_serp_element: { rank_absolute: 3, url: "https://rival.cl/trajes" } }] });
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  Object.assign(process.env, { DATAFORSEO_LOGIN: "l", DATAFORSEO_PASSWORD: "p", DATAFORSEO_BASE_URL: `http://127.0.0.1:${(srv.address() as any).port}`, DATAFORSEO_MONTHLY_USD: "5" });
  const { db } = await import("./db");
  const ws = await db.workspace.create({ data: { name: "test-bl" } });
  projectId = (await db.project.create({ data: { workspaceId: ws.id, name: "bl", domain: "www.mi-tienda.cl", settings: { competitors: ["https://www.rival.cl/", "youtube.com"] } } })).id;
});

after(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  // el gasto simulado no debe quedar contando para el presupuesto mensual de otros tests
  await db.providerUsage.deleteMany({ where: { projectId } });
  await db.project.deleteMany({ where: { id: projectId } });
  await db.$disconnect();
  srv?.close();
});

test("backlinks: foto con competidores, reuso semanal, informe con tareas de links rotos y brecha", { skip: !hasDb }, async () => {
  const { runBacklinks, backlinksOverview } = await import("./backlinks");
  const r: any = await runBacklinks(projectId);
  assert.deepEqual(r.competitors, ["rival.cl"], "limpia el dominio y descarta plataformas como YouTube");
  assert.deepEqual(r.errors, []);
  assert.ok(hits.some((h) => h.path.endsWith("/domain_intersection/live") && h.body.exclude_targets[0] === "mi-tienda.cl"));
  const calls = hits.length;
  assert.ok("reused" in (await runBacklinks(projectId)), "segunda vez en la semana: no vuelve a llamar");
  assert.equal(hits.length, calls);

  const o = (await backlinksOverview(projectId)).snapshot!;
  assert.equal(o.summary.referringDomains, 30);
  assert.equal(o.competitorSummaries[0].referringDomains, 140);
  assert.deepEqual(o.newDomains.map((d) => d.domain), ["prensa.cl"]);
  assert.equal(o.lost[0].domain, "viejo.cl");

  const { buildReport } = await import("./report");
  const md = await buildReport(projectId);
  assert.match(md, /## Backlinks[\s\S]*\| mi-tienda\.cl \(tú\) \| 30 \|/);
  assert.match(md, /Recuperar 1 backlink que llegan a 1 página con error/);
  assert.match(md, /Conseguir links de 1 dominio que ya enlazan a la competencia/);
  const { db } = await import("./db");
  assert.ok((await db.providerUsage.count({ where: { projectId, provider: "dataforseo" } })) >= 6, "costo real registrado por llamada");

  // keyword gap con la misma cuenta: keywords del competidor que el sitio no tiene, con meses pico
  const { runKeywordGap, gapOverview } = await import("./keyword-gap");
  const g: any = await runKeywordGap(projectId);
  assert.equal(g.keywords, 1);
  const lab = hits.find((h) => h.path.includes("dataforseo_labs"))!.body;
  assert.equal(lab.target1, "rival.cl");
  assert.equal(lab.target2, "mi-tienda.cl");
  assert.equal(lab.intersections, false);
  const ov = await gapOverview(projectId);
  assert.deepEqual(ov.gap!.items[0].peaks, [1]);
  // sin crawl ni Search Console no se sabe el rubro del sitio: la brecha se muestra, pero no se vuelve tarea
  assert.doesNotMatch(await buildReport(projectId), /Cubrir 1 keyword/);
  // con el catálogo rastreado («Trajes de competición») la keyword es del rubro y apunta a la página que ya existe
  const crawl = await db.crawl.create({ data: { projectId, status: "completed" } });
  await db.page.create({ data: { crawlId: crawl.id, url: "https://www.mi-tienda.cl/trajes", status: 200, contentType: "text/html", title: "Trajes de competición | Mi tienda", h1: ["Trajes de competición"] } });
  assert.match(await buildReport(projectId), /Cubrir 1 keyword del rubro donde la competencia aparece y el sitio no[^\n]*«trajes de competicion» → optimizar https:\/\/www\.mi-tienda\.cl\/trajes/);
});
