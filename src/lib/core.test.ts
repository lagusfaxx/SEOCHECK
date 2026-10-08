import { test } from "node:test";
import assert from "node:assert/strict";
import { hdbscan } from "./keywords/hdbscan";
import { difficultyProxy, embeddingClusters, overlapClusters } from "./keywords/cluster";
import { ruleIntent } from "./keywords/intent";
import { parseRobots } from "./audit/robots";
import { parseHtml } from "./audit/crawler";
import { parseSerpent } from "./providers/serpent";
import { ngrams } from "./text";

test("hdbscan separa dos grupos", () => {
  const a = Array.from({ length: 6 }, (_, i) => [1, 0.05 * i, 0]);
  const b = Array.from({ length: 6 }, (_, i) => [0, 1, 0.05 * i]);
  const l = hdbscan([...a, ...b], 3, 3);
  assert.equal(new Set(l.slice(0, 6)).size, 1);
  assert.equal(new Set(l.slice(6)).size, 1);
  assert.notEqual(l[0], l[6]);
});

test("overlap ≥3 URLs y mismo intent", () => {
  const u = (n: number[]) => n.map((i) => `https://s${i}.cl/`);
  const c = overlapClusters([
    { term: "a", volume: 100, intent: "informational", urls: u([1, 2, 3, 4, 5]) },
    { term: "b", volume: 50, intent: "informational", urls: u([1, 2, 3, 9]) },
    { term: "c", volume: 40, intent: "transactional", urls: u([1, 2, 3, 4]) },
    { term: "d", volume: 30, intent: "informational", urls: u([1, 7, 8]) },
  ]);
  assert.deepEqual(c.map((x) => x.members.map((m) => m.term)), [["a", "b"], ["c"], ["d"]]);
});

test("embedding fallback", () => {
  const c = embeddingClusters([
    { term: "a", volume: 10, intent: "i", urls: [], vec: [1, 0] },
    { term: "b", volume: 5, intent: "i", urls: [], vec: [0.99, 0.1] },
    { term: "c", volume: 5, intent: "i", urls: [], vec: [0, 1] },
  ]);
  assert.equal(c.length, 2);
});

test("intent por reglas", () => {
  assert.equal(ruleIntent("comprar zapatillas"), "transactional");
  assert.equal(ruleIntent("qué es seo"), "informational");
  assert.equal(ruleIntent("mejores zapatillas running"), "commercial");
  assert.equal(ruleIntent("zapatillas nike", [], ["nike"]), "navigational");
  assert.equal(ruleIntent("zapatillas"), null);
});

test("dificultad sube con dominios fuertes", () => {
  const weak = Array.from({ length: 10 }, (_, i) => ({ position: i + 1, url: `https://x${i}.cl/`, title: "", domain: `x${i}.cl` }));
  const strong = weak.map((o, i) => (i < 6 ? { ...o, domain: "mercadolibre.cl" } : o));
  assert.ok(difficultyProxy(strong) > difficultyProxy(weak) + 30);
});

test("robots", () => {
  const r = parseRobots("User-agent: Googlebot\nDisallow: /g\n\nUser-agent: *\nDisallow: /admin\nAllow: /admin/pub\nSitemap: https://a.cl/s.xml");
  assert.deepEqual(r.disallow, ["/admin"]);
  assert.deepEqual(r.allow, ["/admin/pub"]);
  assert.deepEqual(r.sitemaps, ["https://a.cl/s.xml"]);
});

test("parseHtml", () => {
  const h = parseHtml(
    `<html><head><title>Hola</title><link rel="canonical" href="/x"><meta name="robots" content="noindex">
     <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":"WebPage"}]}</script>
     <script type="application/ld+json">{bad</script></head>
     <body><h1>Uno</h1><h2>¿Qué es?</h2><img src=a.png><a href="/y">y</a><a href="https://otro.cl" rel="nofollow">n</a><p>texto de prueba</p></body></html>`,
    "https://a.cl/x"
  );
  assert.equal(h.title, "Hola");
  assert.equal(h.canonicalType, "self");
  assert.equal(h.noindex, true);
  assert.deepEqual(h.jsonldTypes, ["Organization", "WebPage"]);
  assert.equal(h.jsonldErrors, 1);
  assert.equal(h.imgNoAlt, 1);
  assert.deepEqual(h.links, ["https://a.cl/y"]);
});

test("parseSerpent", () => {
  const s = parseSerpent("q", {
    results: { organic: [{ position: 1, url: "https://www.a.cl/x", title: "A" }], peopleAlsoAsk: [{ question: "¿p?" }], relatedSearches: [{ query: "r" }], aiOverview: null },
    metadata: { hasPeopleAlsoAsk: true, hasAiOverview: false, hasShopping: true },
  });
  assert.equal(s.organic[0].domain, "a.cl");
  assert.deepEqual(s.paa, ["¿p?"]);
  assert.deepEqual(s.related, ["r"]);
  assert.deepEqual(s.features.sort(), ["paa", "shopping"]);
});

test("ngrams sin stopwords en bordes", () => {
  const g = ngrams("guía de zapatillas para correr");
  assert.ok(g.includes("guia de zapatillas"));
  assert.ok(!g.some((x) => x.startsWith("de ")));
});

test("urlKey: variantes de la misma URL cuentan como una", async () => {
  const { urlKey } = await import("./util");
  const variants = [
    "https://www.Ejemplo.cl/zapatillas/trail/",
    "http://ejemplo.cl/zapatillas/trail",
    "https://EJEMPLO.CL/zapatillas/trail#reviews",
    "https://www.ejemplo.cl:443/zapatillas/trail/?utm_source=google&utm_medium=cpc",
    "https://ejemplo.cl/zapatillas/trail?gclid=abc123",
    "https://ejemplo.cl/zapatillas/trail/?fbclid=xyz&utm_campaign=x#top",
    "http://www.ejemplo.cl:80/zapatillas/trail//",
  ];
  assert.equal(new Set(variants.map(urlKey)).size, 1);
  // Distintas de verdad: otro path, parámetro real, otro subdominio
  assert.notEqual(urlKey("https://ejemplo.cl/zapatillas/trail?talla=42"), urlKey("https://ejemplo.cl/zapatillas/trail"));
  assert.equal(urlKey("https://ejemplo.cl/a?b=2&a=1"), urlKey("https://ejemplo.cl/a?a=1&b=2"));
  assert.notEqual(urlKey("https://tienda.ejemplo.cl/x"), urlKey("https://ejemplo.cl/x"));
});

test("overlap usa URLs normalizadas: variantes cuentan como coincidencia", () => {
  const a = ["https://www.a.cl/x/", "http://b.cl/y?utm_source=g", "https://c.cl/z#f", "https://d.cl/"];
  const b = ["https://a.cl/x", "https://www.b.cl/y/", "http://C.cl/z/?gclid=1", "https://e.cl/"];
  const c = overlapClusters([
    { term: "k1", volume: 10, intent: "i", urls: a },
    { term: "k2", volume: 5, intent: "i", urls: b },
  ]);
  assert.deepEqual(c.map((x) => x.members.map((m) => m.term)), [["k1", "k2"]]);
  // urls originales se conservan para mostrar
  assert.deepEqual(c[0].primary.urls, a);
});

test("matchGroups: ancla, mayoría de miembros previos y una estructura por grupo", async () => {
  const { matchGroups } = await import("./keywords/reconcile");
  const existing = [
    { id: "A", anchor: "zapatillas trail", prevMembers: new Set(["zapatillas trail", "trail barato"]) },
    { id: "B", anchor: null, prevMembers: new Set(["x", "y", "z"]) },
  ];
  const r = matchGroups(
    [
      { members: ["zapatillas trail", "nuevo"] }, // ancla → A
      { members: ["x", "y", "w"] }, // 2/3 previos → B
      { members: ["trail barato", "q", "r"] }, // 1/3 < 0.5 y A ya tomado → nuevo
      { members: ["z"] }, // B ya tomado → nuevo
    ],
    existing
  );
  assert.deepEqual(r, ["A", "B", null, null]);
});

test("matchGroups no depende del orden de entrada", async () => {
  const { matchGroups } = await import("./keywords/reconcile");
  const existing = [
    { id: "A", anchor: "a1", prevMembers: new Set(["a1", "a2"]) },
    { id: "B", anchor: null, prevMembers: new Set(["x", "y", "z"]) },
  ];
  const groups = [{ members: ["z"] }, { members: ["x", "y", "w"] }, { members: ["a2", "a1"] }];
  const fwd = matchGroups(groups, existing);
  const rev = matchGroups([...groups].reverse(), existing).reverse();
  assert.deepEqual(fwd, rev);
  assert.deepEqual(fwd, [null, "B", "A"]);
});

test("crawl: fallido si no se pudo leer el sitio, parcial con motivo, completado si no", async () => {
  const { classifyCrawl } = await import("./audit/crawler");
  const html = "text/html; charset=utf-8";
  const S = "https://x.cl/";
  // DNS/timeout en la home y nada más
  let o = classifyCrawl({ pages: [{ url: S, finalUrl: S, status: 0, error: "fetch_failed", contentType: null }], start: S, wafAbort: false, startError: "el dominio no resuelve (DNS)" });
  assert.deepEqual(o, { status: "failed", reason: "No se pudo acceder al sitio: no se pudo conectar: el dominio no resuelve (DNS)." });
  // Cloudflare bloquea todo
  o = classifyCrawl({ pages: [{ url: S, finalUrl: S, status: 403, error: "blocked_by_waf", contentType: html }], start: S, wafAbort: true });
  assert.equal(o.status, "failed");
  assert.match(o.reason!, /firewall/);
  // la home responde 500
  o = classifyCrawl({ pages: [{ url: S, finalUrl: S, status: 500, contentType: html }], start: S, wafAbort: false });
  assert.match(o.reason!, /HTTP 500/);
  // se leyó algo pero el WAF cortó
  const ok = (u: string) => ({ url: u, finalUrl: u, status: 200, contentType: html });
  o = classifyCrawl({ pages: [ok(S), ok(S + "a")], start: S, wafAbort: true });
  assert.equal(o.status, "partial");
  // >30% de timeouts/5xx
  o = classifyCrawl({ pages: [ok(S), ok(S + "a"), ok(S + "b"), { url: S + "c", finalUrl: S + "c", status: 0, error: "fetch_failed", contentType: null }, { url: S + "d", finalUrl: S + "d", status: 503, contentType: html }], start: S, wafAbort: false });
  assert.equal(o.status, "partial");
  assert.match(o.reason!, /2 de 5 URLs no respondieron/);
  // bloqueadas por robots no cuentan como fallas; un 404 tampoco
  o = classifyCrawl({ pages: [ok(S), ok(S + "a"), { url: S + "login", finalUrl: S + "login", status: 0, contentType: null, robotsBlocked: true }, { url: S + "x", finalUrl: S + "x", status: 404, contentType: html }], start: S, wafAbort: false });
  assert.deepEqual(o, { status: "completed", reason: null });
});
