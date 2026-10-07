import { test } from "node:test";
import assert from "node:assert/strict";
import { detectWaf, PatternLimiter, stripParams, urlPattern } from "./audit/guards";

const H = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });

// Firmas tomadas de respuestas reales (patreon.com, medium.com, indeed.com, etsy.com) a un UA de bot.
test("detecta challenges de Cloudflare y otros WAF", () => {
  assert.equal(detectWaf(403, H({ "cf-mitigated": "challenge", server: "cloudflare" }), "<html>"), true);
  assert.equal(detectWaf(403, H({ server: "cloudflare" }), "<html><head><title>Just a moment...</title><script>window._cf_chl_opt={}</script>"), true);
  assert.equal(detectWaf(503, H({ server: "cloudflare" }), '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>'), true);
  assert.equal(detectWaf(403, H({ server: "cloudflare" }), "<title>Attention Required! | Cloudflare</title>"), true);
  assert.equal(detectWaf(403, H({ server: "DataDome", "x-datadome": "protected" }), '<script src="https://ct.captcha-delivery.com/c.js">'), true);
  assert.equal(detectWaf(403, H({ server: "AkamaiGHost" }), "<H1>Access Denied</H1>"), true);
});

test("no confunde páginas normales ni 403/404 propios con WAF", () => {
  assert.equal(detectWaf(200, H({ server: "cloudflare" }), "<title>Just a moment...</title>"), false);
  assert.equal(detectWaf(403, H({ server: "nginx" }), "<title>Prohibido</title>"), false);
  assert.equal(detectWaf(404, H({ server: "cloudflare" }), "<title>No encontrado</title>"), false);
  assert.equal(detectWaf(200, H({}), "<html>contenido</html>"), false);
});

test("urlPattern agrupa facetas y paginación", () => {
  assert.equal(urlPattern("https://a.cl/productos/123?color=rojo&talla=42"), urlPattern("https://a.cl/productos/987?talla=40&color=azul"));
  assert.equal(urlPattern("https://a.cl/calendario/2026/10/07"), "/calendario/{n}/{n}/{n}");
  assert.equal(urlPattern("https://a.cl/item/5f3a9c2e1b7d4a00"), "/item/{id}");
  assert.notEqual(urlPattern("https://a.cl/blog/a"), urlPattern("https://a.cl/blog/a?page=2"));
});

test("stripParams con comodines y '*'", () => {
  assert.equal(stripParams("https://a.cl/x?utm_source=g&utm_medium=c&id=5&gclid=9", ["utm_*", "gclid"]), "https://a.cl/x?id=5");
  assert.equal(stripParams("https://a.cl/x?a=1&b=2", ["*"]), "https://a.cl/x");
  assert.equal(stripParams("https://a.cl/x?orderby=price&a=1", ["orderby", "sort"]), "https://a.cl/x?a=1");
});

test("PatternLimiter corta una trampa de facetas", () => {
  const lim = new PatternLimiter(50);
  let ok = 0;
  for (let i = 0; i < 1000; i++) if (lim.allow(`https://a.cl/catalogo?color=${i}&talla=${i % 7}`)) ok++;
  assert.equal(ok, 50);
  assert.equal(lim.allow("https://a.cl/contacto"), true);
  assert.equal([...lim.skipped.values()][0], 950);
});
