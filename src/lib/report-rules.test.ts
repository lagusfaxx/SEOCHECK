import { test } from "node:test";
import assert from "node:assert/strict";
import { brandFromDomain, editDistance, isBrandQuery, isParamCanonical, PRIVATE_PATH, psiVerdict, spellingVariants } from "./report-rules";

test("distancia de edición con transposición y corte", () => {
  assert.equal(editDistance("masaje", "masage"), 1);
  assert.equal(editDistance("uzeed", "uzede"), 1); // transposición
  assert.equal(editDistance("penalolen", "peñalolen"), 1);
  assert.equal(editDistance("abc", "xyzabc", 2), 3);
});

test("consultas de marca, con errores de tipeo", () => {
  const b = brandFromDomain("www.uzeed.cl");
  assert.equal(b, "uzeed");
  for (const q of ["uzeed", "uzeed escort", "uzed", "useed", "u zeed", "uzeed.cl", "UZEED Chile"]) assert.ok(isBrandQuery(q, b), q);
  for (const q of ["escort santiago", "masajes", "zona sur"]) assert.ok(!isBrandQuery(q, b), q);
  assert.equal(brandFromDomain("mi-sitio.cl"), "misitio");
  assert.ok(isBrandQuery("mi sitio", "misitio"));
});

test("canonical de URL con parámetros hacia la versión sin parámetros", () => {
  assert.ok(isParamCanonical("https://x.cl/a?orden=precio", "https://x.cl/a"));
  assert.ok(isParamCanonical("https://www.x.cl/a/?p=2", "https://x.cl/a"));
  assert.ok(!isParamCanonical("https://x.cl/a", "https://x.cl/b"));
  assert.ok(!isParamCanonical("https://x.cl/a?p=2", "https://x.cl/b"));
});

test("rutas privadas que es normal bloquear en robots", () => {
  for (const p of ["/login/", "/mi-cuenta/pedidos/", "/carrito/", "/checkout/", "/wp-admin/"]) assert.ok(PRIVATE_PATH.test(p), p);
  for (const p of ["/escorts/las-condes/", "/blog/cuenta-regresiva-navidad/"]) assert.ok(!PRIVATE_PATH.test(p), p);
});

test("variantes ortográficas con tráfico en la misma página", () => {
  const g = spellingVariants([
    { query: "masajes penalolen", impressions: 300, clicks: 2, position: 6 },
    { query: "masajes peñalolen", impressions: 120, clicks: 1, position: 7 },
    { query: "masajes peñalolén", impressions: 25, clicks: 0, position: 9 },
    { query: "masajes providencia", impressions: 400, clicks: 3, position: 8 },
    { query: "masajes penalolen x", impressions: 5, clicks: 0, position: 30 },
  ]);
  assert.equal(g.length, 1);
  assert.equal(g[0].main.query, "masajes penalolen");
  assert.deepEqual(g[0].variants.map((v) => v.query).sort(), ["masajes peñalolen", "masajes peñalolén"]);
});

test("PageSpeed: campo primero; laboratorio solo sin campo; discrepancia lab vs campo", () => {
  const good = { source: "url" as const, lcp: { p75: 1900, cat: "FAST" }, inp: { p75: 100, cat: "FAST" }, cls: { p75: 0.01, cat: "FAST" } };
  const v1 = psiVerdict(31, { lcp: 9000 }, good);
  assert.deepEqual([v1.hasField, v1.fieldBad, v1.discrepancy, v1.actionable], [true, false, true, false]);
  const v2 = psiVerdict(22, { lcp: 7000 }, { source: null });
  assert.deepEqual([v2.hasField, v2.actionable], [false, true]);
  const v3 = psiVerdict(80, { lcp: 2000 }, { ...good, lcp: { p75: 4200, cat: "SLOW" } });
  assert.deepEqual([v3.fieldBad, v3.actionable, v3.discrepancy], [true, true, false]);
});
