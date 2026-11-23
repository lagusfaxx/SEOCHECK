import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeShop, normalizeWpUrl, shopifyImageStem, shopifyResourceOf, wpSignature, CmsError } from "./cms/client";
import { wordpressPlugin } from "./cms/plugin";
import { zipStore } from "./cms/zip";
import { needsPush } from "./cms/service";
import { sanitizeArticle, slugify, wordCount } from "./articles/write";
import { toMarkdown } from "./cms/api";
import { buildPayload, liveScript, redirectFor } from "./fixes/live";

const hasPhp = (() => {
  try {
    execFileSync("php", ["-v"]);
    return true;
  } catch {
    return false;
  }
})();

test("WordPress: dirección del sitio sin wp-admin ni barra final", () => {
  assert.equal(normalizeWpUrl("misitio.cl/wp-admin/plugins.php"), "https://misitio.cl");
  assert.equal(normalizeWpUrl("https://misitio.cl/blog/"), "https://misitio.cl/blog");
  assert.throws(() => normalizeWpUrl("ftp://x"), CmsError);
});

test("WordPress: la firma cambia con el cuerpo, el método, la ruta y el tiempo", () => {
  const s = wpSignature("secreto", 100, "POST", "/fsv-search/v1/draft", "{}");
  assert.match(s, /^[0-9a-f]{64}$/);
  assert.notEqual(s, wpSignature("secreto", 100, "POST", "/fsv-search/v1/draft", '{"a":1}'));
  assert.notEqual(s, wpSignature("secreto", 101, "POST", "/fsv-search/v1/draft", "{}"));
  assert.notEqual(s, wpSignature("secreto", 100, "GET", "/fsv-search/v1/draft", "{}"));
  assert.notEqual(s, wpSignature("otro", 100, "POST", "/fsv-search/v1/draft", "{}"));
});

test("WordPress: el plugin generado es PHP válido y no deja romper sus constantes", { skip: !hasPhp && "sin PHP" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fsv-plugin-"));
  const file = path.join(dir, "fsv-search.php");
  writeFileSync(file, wordpressPlugin({ api: "https://app.cl/api/live/abc'); evil(); //", secret: "s3cr3t\\'", app: "https://app.cl/p/1/fixes" }));
  assert.match(execFileSync("php", ["-l", file]).toString(), /No syntax errors/);
  // la constante queda como texto: lo que trae la URL no se ejecuta
  const api = execFileSync("php", ["-r", `define('ABSPATH','x'); function add_action(){} function add_filter(){} function plugin_basename(){return 'x';} require '${file}'; echo FSV_SEARCH_API, "|", FSV_SEARCH_SECRET;`]).toString();
  assert.equal(api, "https://app.cl/api/live/abc'); evil(); //|s3cr3t\\'");
});

test("WordPress: el plugin va en un .zip con su carpeta, como lo pide «Subir plugin»", { skip: !hasPhp && "sin PHP" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fsv-zip-"));
  const file = path.join(dir, "p.zip");
  writeFileSync(file, zipStore([{ name: "fsv-search/fsv-search.php", data: "<?php // ñ" }, { name: "fsv-search/readme.txt", data: "hola" }]));
  const out = execFileSync("php", ["-r", `$z = new ZipArchive; $z->open('${file}'); echo $z->numFiles, "|", $z->getNameIndex(0), "|", $z->getFromName('fsv-search/fsv-search.php');`]).toString();
  assert.equal(out, "2|fsv-search/fsv-search.php|<?php // ñ");
});

test("Shopify: dominio de la tienda y recurso de cada URL", () => {
  assert.equal(normalizeShop("https://Mi-Tienda.myshopify.com/admin"), "mi-tienda.myshopify.com");
  assert.equal(normalizeShop("mi-tienda"), "mi-tienda.myshopify.com");
  assert.throws(() => normalizeShop("tienda con espacios"), CmsError);
  assert.deepEqual(shopifyResourceOf("https://t.cl/products/cafetera-latte"), { type: "product", handle: "cafetera-latte" });
  assert.deepEqual(shopifyResourceOf("https://t.cl/en/collections/cafeteras/products/latte"), { type: "product", handle: "latte" });
  assert.deepEqual(shopifyResourceOf("https://t.cl/collections/cafeteras/"), { type: "collection", handle: "cafeteras" });
  assert.deepEqual(shopifyResourceOf("https://t.cl/pages/envios"), { type: "page", handle: "envios" });
  assert.deepEqual(shopifyResourceOf("https://t.cl/blogs/news/como-elegir"), { type: "article", handle: "como-elegir" });
  assert.equal(shopifyResourceOf("https://t.cl/"), null);
  // un handle con comillas no puede romper la búsqueda
  assert.equal(shopifyResourceOf("https://t.cl/products/a'%20OR%20title:*"), null);
  assert.equal(shopifyImageStem("https://cdn.shopify.com/s/files/1/Latte-Frontal_800x800.jpg?v=3"), "latte-frontal");
  assert.equal(shopifyImageStem("https://t.cl/cdn/shop/files/latte-frontal.jpg?width=600"), "latte-frontal");
});

test("Shopify: se reenvía solo lo nuevo, lo editado o lo que falló", () => {
  const t = new Date("2026-01-01T00:00:00Z");
  const later = (ms: number) => new Date(t.getTime() + ms);
  assert.equal(needsPush({ pushedAt: null, pushError: null, pushedTo: null, updatedAt: t }), true);
  assert.equal(needsPush({ pushedAt: t, pushError: null, pushedTo: "gid://x", updatedAt: later(30) }), false);
  assert.equal(needsPush({ pushedAt: t, pushError: null, pushedTo: "gid://x", updatedAt: later(60_000) }), true);
  assert.equal(needsPush({ pushedAt: t, pushError: "falló", pushedTo: null, updatedAt: later(30) }), true);
  // lo que Shopify no permite por API no se reintenta en cada envío
  assert.equal(needsPush({ pushedAt: t, pushError: "no aplica", pushedTo: "n/a", updatedAt: later(30) }), false);
});

test("en vivo: las redirecciones van al servidor del sitio, nunca al script del navegador", () => {
  const p = buildPayload([{ url: "", kind: "redirect", target: "https://t.cl/vieja/?utm_source=x", after: "https://t.cl/nueva" }, { url: "https://t.cl/a", kind: "title", target: "", after: "T" }]);
  assert.equal(redirectFor(p, "/vieja"), "https://t.cl/nueva");
  assert.equal(redirectFor(p, "/otra"), null);
  assert.ok(!liveScript("https://app", p).includes("/nueva"));
});

test("artículos: se limpia el HTML, se quitan links inventados y datos comerciales sin respaldo", () => {
  const html = `<h1>Guía</h1><script>alert(1)</script><style>p{}</style><!-- nota --><p onclick="x()" style="a">Texto <a href="/cafeteras" target="_blank">cafeteras</a> y <a href="/no-existe">otra</a> y <a href="javascript:alert(1)">x</a>.</p><p>Hoy con 30% de descuento. La presión ronda los 9 bares.</p><p>Somos la mejor tienda del país.</p><img src="x" onerror="y"><iframe src="z"></iframe><div><span>Contenido en div</span></div>`;
  const r = sanitizeArticle(html, { knownUrls: ["https://t.cl/cafeteras"], base: "https://t.cl/blog/x", source: "Tienda de cafeteras" });
  assert.ok(!/script|style|onclick|onerror|iframe|<img|<!--|javascript|<div|<span|<h1/i.test(r.html), r.html);
  assert.match(r.html, /^<h2>Guía<\/h2>/);
  assert.match(r.html, /<a href="https:\/\/t\.cl\/cafeteras">cafeteras<\/a> y otra y x\./);
  assert.match(r.html, /<p>La presión ronda los 9 bares\.<\/p>/);
  assert.ok(!r.html.includes("descuento") && !r.html.includes("mejor tienda"));
  assert.match(r.html, /Contenido en div/);
  assert.equal(r.warnings.length, 3);
  // lo que escribe la persona: se limpia el HTML pero no se le quitan frases (solo se avisa)
  const own = sanitizeArticle("<p>Somos la mejor tienda del país.</p>", { knownUrls: [], base: "https://t.cl/", source: "", strictClaims: false });
  assert.equal(own.html, "<p>Somos la mejor tienda del país.</p>");
  assert.equal(own.warnings.length, 1);
});

test("artículos: slug, conteo de palabras y Markdown", () => {
  assert.equal(slugify("Cómo Elegir una Cafetera ¡Espresso! 2026"), "como-elegir-una-cafetera-espresso-2026");
  assert.equal(slugify("Año y niño"), "ano-y-nino");
  assert.equal(slugify("¡¡!!"), "articulo");
  assert.equal(wordCount("<h2>Hola mundo</h2><p>uno, dos — tres.</p>"), 5);
  assert.equal(toMarkdown(`<h2>Título</h2><p>Texto con <strong>negrita</strong> y <a href="https://t.cl/a">link</a> &amp; más.</p><ul><li>uno</li><li>dos</li></ul>`), "## Título\n\nTexto con **negrita** y [link](https://t.cl/a) & más.\n\n- uno\n- dos\n");
});
