import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { altFor, bestMatch, buildMeta, buildTitle, calmCase, currentValue, cutAt, generateFixes, homePitch, META_MAX, siteBrand, TITLE_MAX, titleCore, type FixPage } from "./fixes/generate";
import { fixHtml, implementationMd, indexable, metaCsv, redirectFile, redirectsOf, robotsTxt, sitemapXml } from "./fixes/files";
import { buildPayload, headFor, liveScript, opsFor, pageKey } from "./fixes/live";
import { acceptRewrite } from "./fixes/ai";

const O = "https://tienda.cl";
const doc = (head: string, body: string) => `<html><head>${head}</head><body><nav><a href="/">Inicio</a></nav><main>${body}</main><footer><p>Tienda SpA todos los derechos reservados en Chile y el mundo entero.</p></footer></body></html>`;
const page = (path: string, o: Partial<FixPage> & { body?: string } = {}): FixPage => ({
  url: O + path, finalUrl: O + path, status: 200, redirects: [], title: null, metaDesc: null, h1: [], canonical: O + path, canonicalType: "self", noindex: false, template: "other",
  jsonldTypes: [], hreflang: [], images: [], links: [], commerce: {}, inSitemap: true, inlinks: 2,
  responseHtml: o.body != null ? doc(`<meta property="og:title" content="x">`, o.body) : null, ...o,
});
const run = (pages: FixPage[], issues: { url: string; code: string; detail?: string }[] = [], extra = {}) => generateFixes(pages, { domain: "tienda.cl", brand: "Tienda", language: "es", issues, ...extra });
const find = (ps: ReturnType<typeof run>, kind: string, path = "", target?: string) => ps.find((p) => p.kind === kind && p.url === (path ? O + path : "") && (target == null || p.target === target));

test("textos: corte en palabra, sin conectores colgando y dentro del límite", () => {
  assert.equal(cutAt("Trajes de competencia para niñas y niños", 30), "Trajes de competencia");
  assert.ok(cutAt("a ".repeat(200), 50, true).endsWith("…"));
  const m = buildMeta("Primera frase completa del contenido de la página que explica el producto. Segunda frase que agrega el detalle de los envíos a todo el país. Tercera frase que ya no cabe en el espacio disponible de la descripción.");
  assert.ok(m.length <= META_MAX && m.endsWith("."), m);
  assert.ok(!m.includes("Tercera"));
});

test("título: conserva la marca del sitio si cabe; si no, va completo sin la marca antes que recortado", () => {
  assert.equal(buildTitle("Cafetera espresso Barista Pro", "Tienda Demo"), "Cafetera espresso Barista Pro | Tienda Demo");
  const long = buildTitle("Fast skin (fastskin) de competencia hombre y mujer", "TAUPOC Chile", "·");
  assert.equal(long, "Fast skin (fastskin) de competencia hombre y mujer");
  assert.ok(buildTitle("Palabra ".repeat(20), "Marca").length <= TITLE_MAX);
  assert.equal(titleCore("Jammer negro · TAUPOC Chile", "TAUPOC Chile"), "Jammer negro");
  assert.equal(calmCase("GORRO DE NATACIÓN TAUPOC UNISEX", "TAUPOC Chile"), "Gorro de natación TAUPOC unisex");
  assert.equal(calmCase("Gorro de natación", "X"), "Gorro de natación");
});

test("marca del sitio: el sufijo que más se repite en los títulos, con su separador", () => {
  assert.deepEqual(siteBrand(["A · TAUPOC Chile", "B · TAUPOC Chile", "C · TAUPOC Chile", "Otro"], "Taupoc"), { brand: "TAUPOC Chile", sep: "·" });
  assert.deepEqual(siteBrand(["Uno", "Dos", "Tres"], "Marca"), { brand: "Marca", sep: "|" });
});

test("títulos duplicados: cada página recibe el suyo desde su H1 y no se repiten", () => {
  const pages = ["a", "b", "c"].map((x) => page(`/producto/cafetera-${x}`, { title: "Cafetera | Tienda", h1: [`Cafetera modelo ${x.toUpperCase()}`], metaDesc: "x".repeat(100) }));
  const ps = run(pages, pages.map((p) => ({ url: p.url, code: "title_dup" })));
  const titles = ps.filter((p) => p.kind === "title").map((p) => p.after);
  assert.equal(titles.length, 3);
  assert.equal(new Set(titles).size, 3);
  assert.equal(titles[0], "Cafetera modelo A | Tienda");
});

test("descripción: sale del contenido propio de la página, nunca del menú ni del pie", () => {
  const p = page("/guia", { title: "Guía de molienda | Tienda", h1: ["Guía de molienda"], body: `<h1>Guía de molienda</h1><p>La molienda define cuánto tarda el agua en pasar por el café y cambia por completo el sabor de la taza.</p>` });
  const m = find(run([p]), "meta", "/guia")!;
  assert.equal(m.code, "meta_missing");
  assert.match(m.after, /^La molienda define/);
  assert.ok(!/derechos reservados|Inicio/.test(m.after));
});

test("home con título genérico: el título y el H1 salen de la primera frase propia", () => {
  assert.equal(homePitch("Somos una tienda especializada en cafeteras espresso, molinos y accesorios. Despachamos."), "Tienda especializada en cafeteras espresso");
  const p = page("/", { title: "Inicio", template: "home", canonical: null, canonicalType: "none", body: `<p>Somos una tienda especializada en cafeteras espresso, molinos y accesorios para preparar café en casa.</p>` });
  const ps = run([p], [{ url: p.url, code: "canonical_missing" }]);
  // la marca ("Tienda") ya está en el texto: no se repite
  assert.equal(find(ps, "title", "/")!.after, "Tienda especializada en cafeteras espresso");
  assert.equal(find(ps, "h1", "/")!.after, "Tienda especializada en cafeteras espresso");
  assert.equal(find(ps, "canonical", "/")!.after, `${O}/`);
});

test("JSON-LD: producto solo con precio y moneda visibles; FAQ con el texto exacto de la página", () => {
  const withPrice = page("/producto/a", { title: "A | Tienda", h1: ["Cafetera A"], metaDesc: "d".repeat(90), template: "product", commerce: { price: 189990, currency: "clp", availability: "InStock" }, body: `<h1>Cafetera A</h1><h2>¿Sirve para café molido?</h2><p>Sí, tiene un compartimento aparte para café molido.</p><h2>¿Cada cuánto se limpia?</h2><p>Cada tres meses con uso diario en casa.</p>` });
  const noPrice = page("/producto/b", { title: "B | Tienda", h1: ["Cafetera B"], metaDesc: "e".repeat(90), template: "product", body: "<h1>Cafetera B</h1>" });
  const ps = run([withPrice, noPrice]);
  const product = JSON.parse(find(ps, "jsonld", "/producto/a", "Product")!.after);
  assert.equal(product.offers.price, 189990);
  assert.equal(product.offers.priceCurrency, "CLP");
  assert.equal(product.offers.availability, "https://schema.org/InStock");
  assert.equal(find(ps, "jsonld", "/producto/b", "Product"), undefined);
  const faq = JSON.parse(find(ps, "jsonld", "/producto/a", "FAQPage")!.after);
  assert.equal(faq.mainEntity.length, 2);
  assert.equal(faq.mainEntity[0].acceptedAnswer.text, "Sí, tiene un compartimento aparte para café molido.");
  // ya declarado: no se propone de nuevo
  assert.equal(find(run([{ ...withPrice, jsonldTypes: ["Product", "FAQPage"] }]), "jsonld", "/producto/a"), undefined);
});

test("imágenes: alt desde el nombre del archivo; si no dice nada, desde el tema de la página; las decorativas no se tocan", () => {
  assert.equal(altFor(`${O}/img/preparar-espresso-paso-a-paso.jpg`, "X", 0), "Preparar espresso paso a paso");
  assert.equal(altFor(`${O}/img/IMG_20240311_1.jpg`, "Cafetera Latte", 1), "Cafetera Latte – imagen 2");
  assert.equal(altFor(`${O}/api/media/cmtgud5i4005hm801v2ikocnc`, "Jammer negro", 0), "Jammer negro");
  const p = page("/p", { title: "P largo y suficiente | Tienda", h1: ["Página"], metaDesc: "d".repeat(90), images: [{ src: `${O}/a/molino-manual-acero.jpg`, alt: null }, { src: `${O}/a/deco.png`, alt: "" }, { src: `${O}/a/ok.png`, alt: "ya tiene" }] });
  const alts = run([p]).filter((x) => x.kind === "alt");
  assert.deepEqual(alts.map((a) => a.after), ["Molino manual acero"]);
});

test("links rotos y redirecciones: a la página equivalente o a la sección padre, nunca a la home", () => {
  const urls = [`${O}/`, `${O}/molinos-de-cafe`, `${O}/blog`, `${O}/blog/como-preparar-espresso`];
  assert.equal(bestMatch(`${O}/molinos-de-cafe-antiguo`, urls)!.url, `${O}/molinos-de-cafe`);
  assert.equal(bestMatch(`${O}/blog/articulo-borrado-2019`, urls)!.url, `${O}/blog`);
  assert.equal(bestMatch(`${O}/ofertas-2023`, urls), null);
  const pages = [page("/", { title: "Inicio de la tienda | Tienda", h1: ["Tienda"], metaDesc: "d".repeat(90) }), page("/molinos-de-cafe", { title: "Molinos de café | Tienda", h1: ["Molinos"], metaDesc: "f".repeat(90) }), page("/molinos-de-cafe-antiguo", { status: 404, inSitemap: false }), page("/sin-links", { status: 404, inSitemap: false, inlinks: 0 })];
  const ps = run(pages, [{ url: `${O}/`, code: "broken_link", detail: `${O}/molinos-de-cafe-antiguo` }]);
  assert.equal(find(ps, "link", "", `${O}/molinos-de-cafe-antiguo`)!.after, `${O}/molinos-de-cafe`);
  assert.equal(find(ps, "redirect", "", `${O}/molinos-de-cafe-antiguo`)!.after, `${O}/molinos-de-cafe`);
  // un 404 que nadie enlaza ni está en el sitemap no necesita redirección
  assert.equal(find(ps, "redirect", "", `${O}/sin-links`), undefined);
});

test("Search Console: la consulta con impresiones que el título no menciona entra al título", () => {
  const p = page("/molinos", { title: "Productos para moler | Tienda", h1: ["Molinos"], metaDesc: "d".repeat(90) });
  const queries = new Map([[p.url, [{ query: "molino de café manual", impressions: 600, clicks: 3, position: 8 }, { query: "tienda molinos", impressions: 900, clicks: 50, position: 1 }]]]);
  const t = find(run([p], [], { queries, impressions: new Map([[p.url, 1500]]) }), "title", "/molinos")!;
  assert.equal(t.code, "gsc_ctr");
  assert.match(t.after, /^Molino de café manual/);
  assert.ok(t.after.length <= TITLE_MAX);
});

test("no propone nada en páginas noindex, con canonical a otra URL o redirigidas", () => {
  const ps = run([page("/a", { noindex: true }), page("/b", { canonicalType: "other" }), page("/c", { finalUrl: `${O}/d`, redirects: [{ status: 301 }] })]);
  assert.deepEqual(ps, []);
});

test("verificación: el valor actual de la página por tipo de corrección", () => {
  const p = page("/x", { title: " Nuevo título ", metaDesc: "desc", jsonldTypes: ["Product"], images: [{ src: "s", alt: "a" }], links: [`${O}/roto`] });
  assert.equal(currentValue(p, "title", ""), "Nuevo título");
  assert.equal(currentValue(p, "jsonld", "product"), "product");
  assert.equal(currentValue(p, "jsonld", "FAQPage"), null);
  assert.equal(currentValue(p, "alt", "s"), "a");
  assert.equal(currentValue(p, "link", `${O}/roto`), `${O}/roto`);
});

test("archivos: redirecciones en el formato de cada servidor", () => {
  const reds = redirectsOf([{ url: "", kind: "redirect", target: `${O}/viejo`, before: "404", after: `${O}/nuevo`, reason: "" }, { url: "", kind: "redirect", target: `${O}/viejo`, before: "404", after: `${O}/otro`, reason: "" }, { url: "", kind: "link", target: "a", before: null, after: "b", reason: "" }]);
  assert.deepEqual(reds, [{ from: `${O}/viejo`, to: `${O}/nuevo` }]);
  assert.match(redirectFile("apache", reds), /RewriteRule \^viejo\/\?\$ \/nuevo \[R=301,L,QSD\]/);
  assert.match(redirectFile("nginx", reds), /location = \/viejo \{ return 301 \/nuevo; \}/);
  assert.deepEqual(JSON.parse(redirectFile("vercel", reds)).redirects, [{ source: "/viejo", destination: "/nuevo", permanent: true }]);
  assert.match(redirectFile("netlify", reds), /\/viejo {2}\/nuevo {2}301/);
  assert.match(redirectFile("shopify", reds), /"Redirect from","Redirect to"\r\n"\/viejo","\/nuevo"/);
  assert.match(redirectFile("next", reds), /"source": "\/viejo"/);
});

test("archivos: el sitemap solo lleva páginas indexables y el robots.txt conserva las reglas actuales", () => {
  const pages = [
    { url: `${O}/`, status: 200, noindex: false, canonicalType: "self" }, { url: `${O}/a?x=1&y=<2>`, status: 200, noindex: false, canonicalType: "self", lastmod: "2026-10-01T10:00:00Z" },
    { url: `${O}/404`, status: 404, noindex: false, canonicalType: null }, { url: `${O}/no`, status: 200, noindex: true, canonicalType: "self" },
    { url: `${O}/variante`, status: 200, noindex: false, canonicalType: "other" }, { url: `${O}/carrito`, status: 200, noindex: false, canonicalType: "self" },
  ];
  assert.equal(indexable(pages).length, 2);
  const xml = sitemapXml(pages);
  assert.match(xml, /<loc>https:\/\/tienda\.cl\/a\?x=1&amp;y=&lt;2&gt;<\/loc><lastmod>2026-10-01<\/lastmod>/);
  assert.ok(!xml.includes("/404") && !xml.includes("/carrito"));
  const r = robotsTxt({ current: "User-agent: *\nDisallow: /admin\n\nUser-agent: GPTBot\nDisallow: /", origin: O, pages });
  assert.match(r, /User-agent: \*\nDisallow: \/admin\nDisallow: \/carrito\n/);
  assert.match(r, /User-agent: GPTBot\nDisallow: \/\n/);
  assert.match(r, /Sitemap: https:\/\/tienda\.cl\/sitemap\.xml\n$/);
  // ya declarado y ya bloqueado: no se duplica
  const same = robotsTxt({ current: "User-agent: *\nDisallow: /carrito\nSitemap: https://tienda.cl/s.xml", origin: O, pages });
  assert.equal(same.match(/Sitemap:/g)!.length, 1);
  assert.equal(same.match(/carrito/g)!.length, 1);
  assert.match(robotsTxt({ current: null, origin: O, pages: [] }), /^User-agent: \*\nDisallow:\n\nSitemap:/);
});

test("archivos: el HTML escapa el contenido y el JSON-LD no puede cerrar su etiqueta", () => {
  assert.equal(fixHtml({ url: "u", kind: "title", target: "", before: null, after: `A "b" <c> & d`, reason: "" }), "<title>A &quot;b&quot; &lt;c&gt; &amp; d</title>");
  const ld = fixHtml({ url: "u", kind: "jsonld", target: "FAQPage", before: null, after: JSON.stringify({ "@type": "FAQPage", x: "</script><script>alert(1)" }), reason: "" });
  assert.ok(!ld.includes("</script><script>"));
  assert.match(fixHtml({ url: "u", kind: "og", target: "", before: null, after: JSON.stringify({ "og:title": "T", "twitter:card": "summary" }), reason: "" }), /<meta property="og:title" content="T">\n<meta name="twitter:card" content="summary">/);
  const fixes = [{ url: `${O}/a`, kind: "title", target: "", before: "=cmd()", after: "Nuevo", reason: "r" }, { url: `${O}/a`, kind: "meta", target: "", before: null, after: "Desc", reason: "r" }, { url: "", kind: "redirect", target: `${O}/v`, before: "404", after: `${O}/n`, reason: "r" }];
  assert.match(metaCsv(fixes), /"https:\/\/tienda\.cl\/a","'=cmd\(\)","Nuevo","","Desc",""/);
  const md = implementationMd({ domain: "tienda.cl", fixes });
  assert.match(md, /## https:\/\/tienda\.cl\/a/);
  assert.match(md, /\| \/v \| \/n \|/);
});

test("en vivo: clave de página estable, operaciones por página y contenido para el <head>", () => {
  assert.equal(pageKey("https://x.cl/a/b/?utm_source=x&b=2&a=1#h"), "/a/b?a=1&b=2");
  assert.equal(pageKey("/"), "/");
  assert.equal(pageKey("https://x.cl"), "/");
  assert.equal(pageKey("/caf%C3%A9/"), "/café");
  const payload = buildPayload([
    { url: `${O}/a`, kind: "title", target: "", after: "Nuevo" }, { url: `${O}/a`, kind: "og", target: "", after: JSON.stringify({ "og:title": "T" }) },
    { url: `${O}/a`, kind: "jsonld", target: "Product", after: `{"@type":"Product"}` }, { url: "", kind: "link", target: `${O}/roto`, after: `${O}/ok` },
  ]);
  assert.deepEqual(opsFor(payload, "https://www.tienda.cl/a/?gclid=1"), [["title", "", "Nuevo"], ["og", "og:title", "T"], ["jsonld", "Product", `{"@type":"Product"}`], ["link", `${O}/roto`, `${O}/ok`]]);
  assert.deepEqual(opsFor(payload, "/otra"), [["link", `${O}/roto`, `${O}/ok`]]);
  const h = headFor(payload, "/a");
  assert.equal(h.title, "Nuevo");
  assert.deepEqual(h.jsonLd, [{ "@type": "Product" }]);
  assert.deepEqual(h.links, { [`${O}/roto`]: `${O}/ok` });
});

test("en vivo: el script es código válido, autocontenido y no deja que un valor cierre la etiqueta script", () => {
  const payload = buildPayload([{ url: `${O}/a`, kind: "title", target: "", after: `</script><script>alert(1)</script>` }]);
  const js = liveScript("https://app.cl/api/live/k", payload);
  assert.ok(!js.includes("</script>"));
  // corre en un navegador simulado: aplica el título como texto, sin ejecutar nada del valor
  const set: Record<string, string> = {};
  const el = () => ({ setAttribute: (k: string, v: string) => (set[k] = v), textContent: "" });
  const document: any = { title: "viejo", head: { querySelector: () => null, appendChild: () => {} }, createElement: el, getElementById: () => null, images: [], querySelectorAll: () => [], readyState: "complete", addEventListener: () => {}, body: null };
  const window: any = { addEventListener: () => {}, sessionStorage: null };
  const location = { pathname: "/a/", search: "?utm_source=x", href: `${O}/a/`, hostname: "tienda.cl" };
  let pinged = "";
  class Img { set src(v: string) { pinged = v; } }
  vm.runInNewContext(js, { document, window, location, history: { pushState() {}, replaceState() {} }, Image: Img, URL, setTimeout, encodeURIComponent, decodeURI, JSON });
  assert.equal(document.title, "</script><script>alert(1)</script>");
  assert.match(pinged, /^https:\/\/app\.cl\/api\/live\/k\/ping\?u=%2Fa%2F&n=1$/);
});

test("IA: se rechazan textos fuera de largo, con enlaces, promesas o cifras que la página no trae", () => {
  const src = "Cafetera espresso de 15 bares. Calienta en 40 segundos.";
  assert.equal(acceptRewrite("title", "Cafetera espresso de 15 bares | Tienda", src), "Cafetera espresso de 15 bares | Tienda");
  assert.equal(acceptRewrite("title", "Cafetera espresso con 30% de descuento hoy", src), null);
  assert.equal(acceptRewrite("title", "Corto", src), null);
  assert.equal(acceptRewrite("title", "x".repeat(80), src), null);
  assert.equal(acceptRewrite("meta", "Compra la cafetera espresso de 15 bares que calienta en 40 segundos. Visita www.otra.cl para más.", src), null);
  assert.equal(acceptRewrite("meta", "La cafetera espresso de 15 bares con resultados garantizados para tu casa y tu oficina cada mañana.", src), null);
  assert.equal(acceptRewrite("meta", `"Cafetera espresso de 15 bares que calienta en 40 segundos, lista para preparar café en casa."`, src), "Cafetera espresso de 15 bares que calienta en 40 segundos, lista para preparar café en casa.");
  assert.equal(acceptRewrite("meta", 42, src), null);
});

test("títulos que se cortan: si al acortarlos quedan iguales, se conserva lo que los distingue", () => {
  const t = (c: string) => `GORRO DE NATACIÓN DE COMPETICIÓN TAUPOC UNISEX BLANCO - DOME-CAPS-W ${c} · TAUPOC Chile`;
  const pages = ["blanco", "Negro"].map((c) => page(`/producto/gorro-${c.toLowerCase()}`, { title: t(c), h1: [`Gorro ${c}`], metaDesc: "d".repeat(90) }));
  const cat = page("/catalogo", { title: "Catálogo de competición · TAUPOC Chile", h1: ["Catálogo"], metaDesc: "c".repeat(90) });
  const ps = run([...pages, cat], pages.map((p) => ({ url: p.url, code: "title_long" })));
  const titles = ps.filter((p) => p.kind === "title").map((p) => p.after);
  assert.equal(titles.length, 2, titles.join(" | "));
  assert.equal(new Set(titles.map((x) => x.toLowerCase())).size, 2, titles.join(" | "));
  assert.ok(titles.some((x) => /negro$/i.test(x)) && titles.some((x) => /blanco$/i.test(x)), titles.join(" | "));
  assert.ok(titles.every((x) => x.length <= 60));
});

test("nunca propone un título que ya usa otra página", () => {
  const a = page("/a", { title: "Cafeteras espresso | Tienda", h1: ["Cafeteras espresso"], metaDesc: "d".repeat(90) });
  const b = page("/b", { title: "Cafe", h1: ["Cafeteras espresso"], metaDesc: "e".repeat(90) });
  assert.equal(find(run([a, b], [{ url: b.url, code: "title_short" }]), "title", "/b"), undefined);
});
