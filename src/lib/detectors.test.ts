/**
 * Un test por detector del crawler. Cada bug real encontrado queda acá como caso para que no vuelva.
 * Fixtures: HTML recortado de WordPress (Yoast), Shopify, Next.js y Wix, con las particularidades que confundían reglas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "@prisma/client";
import { parseHtml, xRobotsNoindex } from "./audit/crawler";
import { computeIssues } from "./audit/issues";
import { parseRobots, robotsAllows } from "./audit/robots";

const S = "https://tienda.cl";
const LONG = "Texto de contenido suficiente para no ser contenido pobre. ".repeat(40);

let n = 0;
function page(over: Partial<Page> & { url: string }): Page {
  return {
    id: `p${n++}`, crawlId: "c", finalUrl: over.url, status: 200, redirects: [], contentType: "text/html; charset=utf-8",
    title: "Un título correcto para la página de prueba", titleLen: 43, metaDesc: "Meta description de largo correcto para la prueba, con más de setenta caracteres para que no sea corta.", metaLen: 104,
    h1: ["Encabezado"], canonical: over.url, canonicalType: "self", noindex: false, hreflang: [], jsonldTypes: [], jsonldErrors: 0,
    wordCount: 600, imgNoAlt: 0, inlinks: 3, outlinks: 5, links: [], responseMs: 200, depth: 1, contentHash: `h${n}`, inSitemap: true,
    orphan: false, blocked: false, error: null, ...over,
  } as Page;
}
const codes = (pages: Page[], ctx = { robotsTxt: "User-agent: *", sitemapCount: 10, site: "tienda.cl" }) => computeIssues(pages, ctx);
const has = (pages: Page[], code: string, url?: string) => codes(pages).some((i) => i.code === code && (!url || i.url === url));

// ---------- parseHtml con HTML real de cada CMS ----------

test("WordPress + Yoast: JSON-LD en @graph y envuelto en CDATA, meta con mayúscula, alt vacío decorativo", () => {
  const h = parseHtml(
    `<html><head><title>Inicio - Mi Blog</title><meta name="Description" content="Blog de prueba con descripción.">
    <link rel="canonical" href="https://blog.cl/" />
    <script type="application/ld+json" class="yoast-schema-graph">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":["Organization","Brand"]}]}</script>
    <script type="application/ld+json">//<![CDATA[
    {"@context":"https://schema.org","@type":"BreadcrumbList"}
    //]]></script></head>
    <body><h1>Mi Blog</h1><img src="sep.png" alt=""><img src="foto.jpg"><img src="https://facebook.com/tr" width="1" height="1"><img src="x.png" alt="" aria-hidden="true"></body></html>`,
    "https://blog.cl/"
  );
  assert.equal(h.metaDesc, "Blog de prueba con descripción."); // bug: name="Description" no se leía
  assert.deepEqual(h.jsonldTypes.sort(), ["Brand", "BreadcrumbList", "Organization", "WebPage"]);
  assert.equal(h.jsonldErrors, 0); // bug: el CDATA de plugins contaba como JSON-LD inválido
  assert.equal(h.imgNoAlt, 1); // bug: alt="" (decorativa) contaba como "sin alt"; el píxel tampoco cuenta
  assert.equal(h.canonicalType, "self");
});

test("Shopify: canonical de ?variant= al producto, hreflang con auto-referencia, ProductGroup", () => {
  const url = `${S}/products/zapatilla?variant=123`;
  const h = parseHtml(
    `<html><head><title>Zapatilla – Tienda</title><link rel="canonical" href="${S}/products/zapatilla">
    <link rel="alternate" hreflang="es-CL" href="${S}/products/zapatilla"><link rel="alternate" hreflang="en" href="${S}/en/products/zapatilla">
    <script type="application/ld+json">{"@context":"http://schema.org/","@type":"ProductGroup","name":"Zapatilla"}</script></head>
    <body><h1>Zapatilla</h1></body></html>`,
    url
  );
  assert.equal(h.canonicalType, "other");
  assert.deepEqual(h.jsonldTypes, ["ProductGroup"]);
  // como issue: canonical de URL con parámetros a la versión limpia NO se reporta
  assert.ok(!has([page({ url, canonical: h.canonical, canonicalType: "other" })], "canonical_other"));
});

test("Next.js: <title> de un SVG del body no reemplaza al de la página; sin <title> en head = sin title", () => {
  const withHead = parseHtml(`<html><head><title>Producto | Next</title></head><body><svg><title>icono</title></svg><h1>X</h1></body></html>`, `${S}/p`);
  assert.equal(withHead.title, "Producto | Next");
  const onlySvg = parseHtml(`<html><head></head><body><svg><title>icono carrito</title></svg><h1>X</h1></body></html>`, `${S}/p`);
  assert.equal(onlySvg.title, null); // bug: tomaba "icono carrito" como title
});

test("noindex: meta robots 'none', googlebot, X-Robots-Tag por bot", () => {
  assert.equal(parseHtml(`<head><meta name="robots" content="none"></head>`, S).noindex, true); // bug: "none" no se detectaba
  assert.equal(parseHtml(`<head><meta name="GoogleBot" content="noindex"></head>`, S).noindex, true);
  assert.equal(parseHtml(`<head><meta name="robots" content="index, follow"></head>`, S).noindex, false);
  assert.equal(xRobotsNoindex("noindex"), true);
  assert.equal(xRobotsNoindex("googlebot: noindex"), true);
  assert.equal(xRobotsNoindex("bingbot: noindex"), false); // bug: un noindex para Bing sacaba la página "de Google"
  assert.equal(xRobotsNoindex("unavailable_after: 25 Jun 2030 15:00:00 PST"), false);
  assert.equal(xRobotsNoindex("bingbot: noindex, googlebot: nofollow"), false);
});

test("canonical relativo se resuelve contra la URL; JSON-LD roto se cuenta", () => {
  const h = parseHtml(`<head><link rel="canonical" href="/a"><script type="application/ld+json">{"@type": "Organization",}</script></head>`, `${S}/a`);
  assert.equal(h.canonical, `${S}/a`);
  assert.equal(h.canonicalType, "self");
  assert.equal(h.jsonldErrors, 1);
});

// ---------- robots.txt como lo aplica Google ----------

test("robots: comodines, $, grupo de Googlebot y precedencia", () => {
  // Shopify: antes "/collections/*sort_by*" se recortaba a "/collections/" y bloqueaba TODAS las colecciones
  const shopify = parseRobots("User-agent: *\nDisallow: /admin\nDisallow: /cart\nDisallow: /collections/*sort_by*\nDisallow: /*/collections/*+*\nDisallow: /search\nSitemap: https://tienda.cl/sitemap.xml");
  assert.equal(robotsAllows(shopify, `${S}/collections/zapatillas`), true);
  assert.equal(robotsAllows(shopify, `${S}/collections/zapatillas?sort_by=price`), false);
  assert.equal(robotsAllows(shopify, `${S}/cart`), false);
  assert.equal(robotsAllows(shopify, `${S}/products/x`), true);
  // WordPress: "/*?" bloquea solo URLs con query (antes bloqueaba todo el sitio)
  const wp = parseRobots("User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\nDisallow: /*?\nDisallow: /*.pdf$");
  assert.equal(robotsAllows(wp, `${S}/blog/post/`), true);
  assert.equal(robotsAllows(wp, `${S}/blog/?s=hola`), false);
  assert.equal(robotsAllows(wp, `${S}/wp-admin/admin-ajax.php`), true);
  assert.equal(robotsAllows(wp, `${S}/wp-admin/options.php`), false);
  assert.equal(robotsAllows(wp, `${S}/doc.pdf`), false);
  assert.equal(robotsAllows(wp, `${S}/doc.pdf?x=1`), false); // la query también la bloquea /*?
  assert.equal(robotsAllows(wp, `${S}/doc.pdfx`), true);
  // Googlebot usa SU grupo y no mezcla con "*"
  const g = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nDisallow: /privado");
  assert.equal(g.group, "googlebot");
  assert.equal(robotsAllows(g, `${S}/publico`), true);
  assert.equal(robotsAllows(g, `${S}/privado/x`), false);
  // empate de largo: gana Allow
  const tie = parseRobots("User-agent: *\nDisallow: /a\nAllow: /a");
  assert.equal(robotsAllows(tie, `${S}/a`), true);
  // varios user-agent en un mismo grupo; BOM al inicio
  const multi = parseRobots("﻿User-agent: bingbot\nUser-agent: googlebot\nDisallow: /x");
  assert.equal(robotsAllows(multi, `${S}/x`), false);
  // sin robots: todo permitido
  assert.equal(robotsAllows(parseRobots(""), `${S}/lo-que-sea`), true);
});

// ---------- computeIssues: un caso por regla ----------

test("detectores de estado HTTP, WAF, SSRF, fetch y redirects", () => {
  assert.ok(has([page({ url: `${S}/a`, status: 404 })], "http_4xx"));
  assert.ok(has([page({ url: `${S}/a`, status: 503 })], "http_5xx"));
  assert.ok(has([page({ url: `${S}/a`, status: 0 })], "fetch_failed"));
  assert.ok(has([page({ url: `${S}/a`, status: 403, error: "blocked_by_waf" })], "blocked_by_waf"));
  assert.ok(has([page({ url: `${S}/a`, status: 0, error: "ssrf_blocked" })], "ssrf_blocked"));
  const chain = page({ url: `${S}/a`, finalUrl: `${S}/c`, redirects: [{ url: `${S}/a`, status: 301 }, { url: `${S}/b`, status: 301 }] as any });
  assert.ok(has([chain], "redirect_chain"));
  const one = page({ url: `${S}/a`, finalUrl: `${S}/a/`, redirects: [{ url: `${S}/a`, status: 301 }] as any, inSitemap: true });
  assert.ok(has([one], "redirect"));
  assert.ok(!has([{ ...one, inSitemap: false }], "redirect")); // un redirect fuera del sitemap no es problema
  // una página que redirige no se evalúa por title/meta/H1 (son de la página destino)
  assert.ok(!codes([{ ...one, title: null }]).some((i) => i.code === "title_missing"));
});

test("detectores de title, meta y H1 (incluye duplicados)", () => {
  assert.ok(has([page({ url: `${S}/a`, title: null, titleLen: 0 })], "title_missing"));
  assert.ok(has([page({ url: `${S}/a`, title: "x".repeat(70), titleLen: 70 })], "title_long"));
  assert.ok(has([page({ url: `${S}/a`, title: "Corto", titleLen: 5 })], "title_short"));
  assert.ok(has([page({ url: `${S}/a`, metaDesc: null, metaLen: 0 })], "meta_missing"));
  assert.ok(has([page({ url: `${S}/a`, metaDesc: "x".repeat(200), metaLen: 200 })], "meta_long"));
  assert.ok(has([page({ url: `${S}/a`, metaDesc: "corta", metaLen: 5 })], "meta_short"));
  assert.ok(has([page({ url: `${S}/a`, h1: [] })], "h1_missing"));
  assert.ok(has([page({ url: `${S}/a`, h1: ["a", "b"] })], "h1_multiple"));
  const d1 = page({ url: `${S}/a`, title: "Igual en las dos páginas", titleLen: 24, metaDesc: "Igual igual igual igual igual igual igual igual igual igual igual igual", metaLen: 71 });
  const d2 = page({ url: `${S}/b`, title: "Igual en las dos páginas", titleLen: 24, metaDesc: "Igual igual igual igual igual igual igual igual igual igual igual igual", metaLen: 71 });
  assert.ok(has([d1, d2], "title_dup", `${S}/b`));
  assert.ok(has([d1, d2], "meta_dup", `${S}/b`));
  // noindex y canonical a otra URL no cuentan como duplicado (es la forma correcta de resolverlo)
  assert.ok(!has([d1, { ...d2, noindex: true, inSitemap: false }], "title_dup"));
  assert.ok(!has([d1, { ...d2, canonicalType: "other", canonical: `${S}/a` }], "title_dup"));
});

test("detectores de canonical, noindex, JSON-LD, hreflang, imágenes", () => {
  assert.ok(has([page({ url: `${S}/a`, canonical: null, canonicalType: "none" })], "canonical_missing"));
  assert.ok(has([page({ url: `${S}/a`, canonical: `${S}/b`, canonicalType: "other" })], "canonical_other"));
  assert.ok(has([page({ url: `${S}/a`, noindex: true, inSitemap: true })], "noindex_in_sitemap"));
  assert.ok(has([page({ url: `${S}/a`, noindex: true, inSitemap: false })], "noindex"));
  assert.ok(has([page({ url: `${S}/a`, jsonldErrors: 2 })], "jsonld_invalid"));
  assert.ok(has([page({ url: `${S}/a`, hreflang: [{ lang: "en", href: `${S}/en/a` }] as any })], "hreflang_no_self"));
  assert.ok(!has([page({ url: `${S}/a`, hreflang: [{ lang: "es", href: `${S}/a` }, { lang: "en", href: `${S}/en/a` }] as any })], "hreflang_no_self"));
  assert.ok(has([page({ url: `${S}/a`, imgNoAlt: 3 })], "img_no_alt"));
  // bug real (wordpress.org/download/releases/7.1/): canonical a 7-1 y se le pedía auto-referencia de hreflang
  assert.ok(!has([page({ url: `${S}/a`, canonical: `${S}/b`, canonicalType: "other", hreflang: [{ lang: "en", href: `${S}/en/b` }] as any })], "hreflang_no_self"));
});

test("detectores de contenido, estructura y rendimiento", () => {
  assert.ok(has([page({ url: `${S}/a`, wordCount: 80 })], "thin_content"));
  assert.ok(!has([page({ url: `${S}/a`, wordCount: 80, noindex: true, inSitemap: false })], "thin_content"));
  const c1 = page({ url: `${S}/a`, contentHash: "same", wordCount: 300 });
  const c2 = page({ url: `${S}/b`, contentHash: "same", wordCount: 300, title: "Otro título distinto para la segunda", titleLen: 35 });
  assert.ok(has([c1, c2], "dup_content"));
  assert.ok(has([page({ url: `${S}/a`, depth: 5 })], "deep_page"));
  assert.ok(has([page({ url: `${S}/a`, responseMs: 2000 })], "slow"));
  assert.ok(has([page({ url: `${S}/a`, orphan: true })], "orphan"));
  assert.ok(has([page({ url: `${S}/a`, inlinks: 0, depth: 2 })], "no_inlinks"));
  assert.ok(!has([page({ url: `${S}/`, inlinks: 0, depth: 0 })], "no_inlinks")); // la home no necesita links entrantes
});

test("links rotos: solo hacia URLs que fallaron y no bloqueadas por robots", () => {
  const ok = page({ url: `${S}/a`, links: [`${S}/roto`, `${S}/bloq`, `${S}/b`] });
  const broken = page({ url: `${S}/roto`, status: 404 });
  const blocked = page({ url: `${S}/bloq`, status: 0, blocked: true });
  const b = page({ url: `${S}/b` });
  const list = codes([ok, broken, blocked, b]).filter((i) => i.code === "broken_link");
  assert.deepEqual(list.map((i) => i.detail), [`${S}/roto`]);
});

test("robots.txt y sitemap ausentes; bloqueadas por robots", () => {
  assert.ok(codes([page({ url: `${S}/` })], { robotsTxt: null, sitemapCount: 10, site: "tienda.cl" } as any).some((i) => i.code === "robots_missing"));
  assert.ok(codes([page({ url: `${S}/` })], { robotsTxt: "x", sitemapCount: 0, site: "tienda.cl" }).some((i) => i.code === "sitemap_missing"));
  const bl = codes([page({ url: `${S}/privado`, status: 0, blocked: true, inSitemap: true })]);
  assert.deepEqual(bl.map((i) => [i.code, i.severity]), [["blocked_robots", "warning"]]); // en el sitemap = contradicción
  assert.equal(codes([page({ url: `${S}/privado`, status: 0, blocked: true, inSitemap: false })])[0].severity, "info");
});

test("links rotos: 429 (límite de ritmo de Shopify), 401/403 y fallas de conexión no son links rotos", () => {
  // bug real (colourpop.com): Shopify respondió 429 al crawler y 4 links quedaron como "rotos" aunque la página existía
  const src = page({ url: `${S}/a`, links: [`${S}/rate`, `${S}/priv`, `${S}/caida`, `${S}/gone`] });
  const list = codes([src, page({ url: `${S}/rate`, status: 429 }), page({ url: `${S}/priv`, status: 403 }), page({ url: `${S}/caida`, status: 0 }), page({ url: `${S}/gone`, status: 410 })]).filter((i) => i.code === "broken_link");
  assert.deepEqual(list.map((i) => i.detail), [`${S}/gone`]);
});

test("Retry-After: segundos o fecha, con tope", async () => {
  const { retryAfterMs } = await import("./audit/crawler");
  assert.equal(retryAfterMs("3"), 3000);
  assert.equal(retryAfterMs("120"), 10_000);
  assert.equal(retryAfterMs(null), 2000);
  assert.ok(retryAfterMs(new Date(Date.now() + 4000).toUTCString()) <= 4000);
});
