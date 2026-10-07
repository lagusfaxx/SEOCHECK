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
