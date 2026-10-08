import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanKeyword, sanitizeKeywords } from "./providers/sanitize";
import { gscError, normalizeGscProperty, parsePsi } from "./providers/google";

test("DataForSEO: limpia símbolos inválidos, emojis y respeta límites", () => {
  assert.equal(cleanKeyword("¿Qué es el SEO?"), "qué es el seo");
  assert.equal(cleanKeyword("zapatillas (trail) | mujer!"), "zapatillas trail mujer");
  assert.equal(cleanKeyword("café ☕ 😀 barato"), "café barato");
  assert.equal(cleanKeyword("c++ & node.js"), "c++ & node.js");
  const { valid, rejected } = sanitizeKeywords([
    "¿Qué es el SEO?",
    "que es el seo?", // misma keyword limpia → se agrupa
    "😀😀",
    "uno dos tres cuatro cinco seis siete ocho nueve diez once",
    "x".repeat(81),
    "zapatillas trail",
  ]);
  assert.deepEqual([...valid.keys()], ["qué es el seo", "que es el seo", "zapatillas trail"]);
  assert.deepEqual(rejected.map((r) => r.reason), ["vacía tras limpiar", "más de 10 palabras", "más de 80 caracteres"]);
});

test("GSC: acepta sc-domain: y https://, normaliza y rechaza lo demás", () => {
  assert.equal(normalizeGscProperty("sc-domain:Ejemplo.CL"), "sc-domain:ejemplo.cl");
  assert.equal(normalizeGscProperty("sc-domain:https://ejemplo.cl/"), "sc-domain:ejemplo.cl");
  assert.equal(normalizeGscProperty("https://www.Ejemplo.cl"), "https://www.ejemplo.cl/");
  assert.equal(normalizeGscProperty("http://ejemplo.cl/blog"), "http://ejemplo.cl/blog/");
  // dominio pelado y variantes mal escritas → propiedad de dominio
  assert.equal(normalizeGscProperty("ejemplo.cl"), "sc-domain:ejemplo.cl");
  assert.equal(normalizeGscProperty("www.Ejemplo.cl"), "sc-domain:ejemplo.cl");
  assert.equal(normalizeGscProperty("sc-ejemplo.cl"), "sc-domain:ejemplo.cl");
  assert.equal(normalizeGscProperty("sc domain ejemplo.cl"), "sc-domain:ejemplo.cl");
  assert.equal(normalizeGscProperty("scotiabank.cl"), "sc-domain:scotiabank.cl");
  assert.throws(() => normalizeGscProperty("mi sitio"), /usa sc-domain:dominio\.cl .* o https:\/\/dominio\.cl\//);
});

test("GSC: 403 dice qué email agregar y dónde", () => {
  process.env.GSC_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "seo-bot@proj.iam.gserviceaccount.com", private_key: "x" });
  // env se lee al cargar; el módulo ya está cargado, así que se parchea el valor
  return import("./env").then(({ env }) => {
    (env as any).gscCredentials = process.env.GSC_SERVICE_ACCOUNT_JSON;
    const e = gscError({ response: { status: 403, data: { error: { message: "User does not have sufficient permission for site 'sc-domain:ejemplo.cl'." } } } }, "sc-domain:ejemplo.cl");
    assert.match(e.message, /Sin acceso a sc-domain:ejemplo\.cl: agrega seo-bot@proj\.iam\.gserviceaccount\.com como usuario/);
    assert.match(gscError({ response: { status: 404 } }, "https://x.cl/").message, /no existe en Search Console/);
  });
});

test("PSI: sin CrUX queda null (sin datos), nunca 0; distingue URL y origen", () => {
  const lighthouse = { lighthouseResult: { categories: { performance: { score: 0.42 } }, audits: { "largest-contentful-paint": { numericValue: 3100 }, "cumulative-layout-shift": { numericValue: 0 } } } };
  const none = parsePsi({ ...lighthouse, loadingExperience: { initial_url: "https://x.cl/" } });
  assert.equal(none.field.source, null);
  assert.equal(none.field.lcp, null);
  assert.equal(none.field.inp, null);
  assert.equal(none.lab.cls, 0); // CLS de laboratorio 0 es un valor real
  assert.equal(none.lab.tbt, null);
  assert.equal(none.score, 42);
  const origin = parsePsi({ ...lighthouse, loadingExperience: { origin_fallback: true, metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2400, category: "FAST" } } } });
  assert.equal(origin.field.source, "origin");
  assert.deepEqual(origin.field.lcp, { p75: 2400, cat: "FAST" });
  assert.equal(origin.field.inp, null);
  const url = parsePsi({ ...lighthouse, loadingExperience: { metrics: { CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 0, category: "FAST" } } } });
  assert.equal(url.field.source, "url");
  assert.deepEqual(url.field.cls, { p75: 0, cat: "FAST" }, "CLS de campo 0 es dato real, no 'sin datos'");
});
