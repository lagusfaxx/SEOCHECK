import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFindings, detectPatterns, kindOf, pageKind, summarize, urlSection, type IssueIn, type PageIn } from "./audit/insights";
import { detectCms } from "./audit/cms";

const S = "https://tienda.cl";
const prod = (i: number) => `${S}/products/producto-${i}`;
const pages: PageIn[] = [
  { url: `${S}/`, status: 200, depth: 0 },
  ...Array.from({ length: 80 }, (_, i) => ({ url: prod(i), status: 200, depth: 2, jsonldTypes: ["Product"] })),
  ...Array.from({ length: 10 }, (_, i) => ({ url: `${S}/blog/nota-${i}`, status: 200, depth: 2 })),
  { url: `${S}/contacto`, status: 200, depth: 1 },
];

test("causa raíz: 76 de 80 productos con title largo = problema de plantilla, corregir una vez", () => {
  const issues: IssueIn[] = Array.from({ length: 76 }, (_, i) => ({ url: prod(i), code: "title_long", severity: "warning", detail: "72" }));
  const { findings } = buildFindings(pages, issues);
  assert.equal(findings.length, 1, "un hallazgo, no 76");
  const f = findings[0];
  assert.equal(f.template, "/products/*");
  assert.equal(f.rootCause, true);
  assert.equal(f.urls.length, 76);
  assert.equal(f.templateSize, 80);
  assert.equal(f.summary, "Posible problema de plantilla /products/*: afecta 76 de 80 URLs. Corrige la plantilla una vez.");
  assert.equal(f.kind, "opportunity");
  assert.equal(f.pageKind, "product");
  assert.match(f.reasons[0], /76 URLs afectadas \(95% de \/products\/\*\)/);
});

test("prioridad por impacto: tráfico de GSC y ranking cercano al top suben la prioridad", () => {
  const issues: IssueIn[] = [
    ...Array.from({ length: 76 }, (_, i) => ({ url: prod(i), code: "title_long", severity: "warning" })),
    ...Array.from({ length: 5 }, (_, i) => ({ url: `${S}/blog/nota-${i}`, code: "meta_dup", severity: "info" })),
    { url: `${S}/contacto`, code: "h1_missing", severity: "warning" },
  ];
  const impr = new Map<string, number>();
  const pos = new Map<string, number>();
  for (let i = 0; i < 76; i++) {
    impr.set(`tienda.cl/products/producto-${i}`, 57);
    pos.set(`tienda.cl/products/producto-${i}`, 8.4);
  }
  impr.set("tienda.cl/blog/nota-0", 3);
  const { findings } = buildFindings(pages, issues, { impr, pos });
  const title = findings.find((f) => f.code === "title_long")!;
  const meta = findings.find((f) => f.code === "meta_dup")!;
  const h1 = findings.find((f) => f.code === "h1_missing")!;
  assert.equal(title.priority, "alta");
  assert.equal(title.impressions, 76 * 57);
  assert.ok(title.reasons.some((r) => /4\.332 impresiones\/mes/.test(r)));
  assert.ok(title.reasons.some((r) => /posición 8,4: cerca de la primera página/.test(r)));
  assert.notEqual(meta.priority, "alta");
  // página sin importancia orgánica: baja
  assert.equal(h1.priority, "baja");
  assert.ok(h1.reasons.includes("sin impresiones en Google (28 días)"));
  assert.equal(findings[0].code, "title_long", "lo de más impacto primero");
});

test("ranking trackeado en 4–20 + problema on-page = prioridad alta con el motivo", () => {
  const issues: IssueIn[] = [{ url: `${S}/contacto`, code: "title_short", severity: "info" }];
  const rank = new Map([["tienda.cl/contacto", { keyword: "tienda online chile", position: 8 }]]);
  const low = buildFindings(pages, issues).findings[0];
  const high = buildFindings(pages, issues, { rank }).findings[0];
  assert.ok(high.points > low.points);
  assert.ok(high.reasons.some((r) => r.includes("«tienda online chile» está en posición 8")));
});

test("PageSpeed malo en la plantilla se cruza con la respuesta lenta", () => {
  const issues: IssueIn[] = Array.from({ length: 6 }, (_, i) => ({ url: prod(i), code: "slow", severity: "info" }));
  const psiBad = new Map([["/products/*", "móvil lento para usuarios reales"]]);
  const f = buildFindings(pages, issues, { psiBad }).findings[0];
  assert.equal(f.psi, "móvil lento para usuarios reales");
  assert.ok(f.points > buildFindings(pages, issues).findings[0].points);
});

test("tipos: confirmado vs posible vs oportunidad (lo subjetivo no es error)", () => {
  assert.equal(kindOf("http_4xx"), "confirmed");
  assert.equal(kindOf("broken_link"), "confirmed");
  assert.equal(kindOf("dup_content"), "possible");
  assert.equal(kindOf("orphan"), "possible");
  assert.equal(kindOf("title_long"), "opportunity");
  assert.equal(kindOf("meta_missing"), "opportunity");
  const s = summarize(buildFindings(pages, [{ url: `${S}/x`, code: "http_4xx", severity: "critical" }, { url: `${S}/contacto`, code: "img_no_alt", severity: "info" }]).findings);
  assert.equal(s.confirmed, 1);
  assert.equal(s.opportunity, 1);
});

test("layout común: el mismo problema en casi todo el sitio es UN hallazgo del layout", () => {
  // link roto en el footer: está en todas las páginas, de todas las secciones
  const issues: IssueIn[] = pages.map((p) => ({ url: p.url, code: "broken_link", severity: "critical", detail: `${S}/viejo` }));
  const { findings } = buildFindings(pages, issues);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].scope, "layout");
  assert.match(findings[0].summary, /plantilla base del sitio .*afecta 92 de 92 URLs/);
  // el mismo issue solo en productos (aunque sean el 87% del sitio) es de la plantilla de producto
  const onlyProducts = buildFindings(pages, issues.filter((i) => i.url.includes("/products/"))).findings;
  assert.equal(onlyProducts[0].template, "/products/*");
});

test("casos sueltos se juntan en un hallazgo (no una tarea por URL)", () => {
  const issues: IssueIn[] = [
    { url: `${S}/contacto`, code: "h1_missing", severity: "warning" },
    { url: `${S}/blog/nota-1`, code: "h1_missing", severity: "warning" },
    { url: prod(3), code: "h1_missing", severity: "warning" },
  ];
  const { findings } = buildFindings(pages, issues);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].template, "varias secciones");
  assert.equal(findings[0].rootCause, false);
});

test("intencional y huérfanas sin confirmar no son hallazgos", () => {
  const issues: IssueIn[] = [
    { url: `${S}/products/a?variant=2`, code: "canonical_other", severity: "info", detail: `${S}/products/a` },
    { url: `${S}/cart`, code: "blocked_robots", severity: "info" },
    { url: `${S}/blog/nota-9`, code: "orphan", severity: "warning" },
    // carrito sin H1 (caso real en sintornillo.cl): no compite en Google
    { url: `${S}/cart`, code: "h1_missing", severity: "warning" },
  ];
  const r = buildFindings(pages, issues, { hitLimit: true });
  assert.equal(r.findings.length, 0);
  assert.equal(r.intentional.length, 3);
  assert.match(r.intentional[2].text, /carrito\/cuenta\/login/);
  assert.equal(buildFindings(pages, issues.slice(2, 3)).findings.length, 1, "sin límite la huérfana sí cuenta");
});

test("patrones: plantilla que concentra, tipo de página, CMS e issues que van juntos", () => {
  const issues: IssueIn[] = [];
  for (let i = 0; i < 40; i++) issues.push({ url: prod(i), code: "title_long", severity: "warning" }, { url: prod(i), code: "meta_missing", severity: "warning" });
  issues.push({ url: `${S}/blog/nota-1`, code: "img_no_alt", severity: "info" });
  const p = detectPatterns(pages, issues, "shopify");
  assert.ok(p.some((x) => x.kind === "cms" && /Shopify.*Temas/.test(x.text)));
  assert.ok(p.some((x) => x.kind === "template" && /\/products\/\* concentra el 99%/.test(x.text)));
  assert.ok(p.some((x) => x.kind === "pageKind" && /fichas de producto/.test(x.text)));
  assert.ok(p.some((x) => x.kind === "together" && /mismas 40 URLs/.test(x.text)));
});

test("tipo de página por URL y datos estructurados", () => {
  assert.equal(pageKind(`${S}/`, [], 0), "home");
  assert.equal(pageKind(`${S}/products/x`), "product");
  assert.equal(pageKind(`${S}/algo`, ["Product"]), "product");
  assert.equal(pageKind(`${S}/collections/ofertas`), "category");
  assert.equal(pageKind(`${S}/blog/como-elegir`), "article");
  assert.equal(pageKind(`${S}/nosotros`), "page");
  assert.equal(urlSection(prod(1)), "/products/*");
});

test("detección de CMS", () => {
  assert.equal(detectCms('<meta name="generator" content="WordPress 6.5"><link href="/wp-content/themes/x.css">'), "wordpress");
  assert.equal(detectCms('<link href="/wp-content/plugins/woocommerce/a.css"><body class="woocommerce">'), "woocommerce");
  assert.equal(detectCms('<script src="//cdn.shopify.com/s/files/x.js"></script>'), "shopify");
  assert.equal(detectCms('<script id="__NEXT_DATA__" type="application/json">{}</script>'), "nextjs");
  assert.equal(detectCms('<html data-wf-site="123">'), "webflow");
  assert.equal(detectCms('<img src="https://assets.jumpseller.com/store/x.jpg">'), "jumpseller");
  assert.equal(detectCms("<html><body>hola</body></html>"), null);
});

test("sin datos mínimos no hay puntaje de salud técnica", async () => {
  const { healthBlocker } = await import("./audit/crawler");
  const html = (status: number, error: string | null = null) => ({ status, error, contentType: "text/html" });
  assert.match(healthBlocker("failed", [html(200)])!, /no se pudo acceder/);
  assert.match(healthBlocker("completed", [html(404), html(500)])!, /ninguna página HTML/);
  assert.match(healthBlocker("partial", [html(200), html(0, "blocked_by_waf"), html(0, "blocked_by_waf")])!, /solo se pudieron leer 1 de 3 URLs/);
  assert.equal(healthBlocker("partial", [html(200), html(200), html(0, "blocked_by_waf")]), null);
  assert.equal(healthBlocker("completed", [html(200)]), null);
});

test("wizard: sugerencias de keywords desde el title/H1 de la home, sin la marca", async () => {
  const { phrasesFrom } = await import("./onboarding");
  assert.deepEqual(phrasesFrom(["Tornillos y fijaciones | SinTornillo", "Ferretería online en Santiago"], "sintornillo"), ["tornillos y fijaciones", "ferretería online en santiago"]);
  assert.deepEqual(phrasesFrom(["Inicio - Mi Tienda", null], "mitienda"), []);
});
