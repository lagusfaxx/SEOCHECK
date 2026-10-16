/** Reglas del informe que separan errores confirmados, comportamiento intencional e hipótesis, con evidencia. */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "@prisma/client";
import { computeIssues, httpEvidence } from "./audit/issues";
import { buildFindings, splitIntentional } from "./audit/insights";
import { serpWidthPx, TITLE_MAX_PX, makeTask } from "./report-rules";
import { verifyBrief } from "./content/claims";
import { periodEndingAt, isoDay } from "./gsc-period";
import type { Brief } from "./content/analyze";

const S = "https://tienda.cl";
let n = 0;
function page(over: Partial<Page> & { url: string }): Page {
  return {
    id: `p${n++}`, crawlId: "c", finalUrl: over.url, status: 200, redirects: [], contentType: "text/html",
    title: "Un título correcto para la página de prueba", titleLen: 43, metaDesc: "Meta description de largo correcto para la prueba, con más de setenta caracteres.", metaLen: 90,
    h1: ["Encabezado"], canonical: over.url, canonicalType: "self", noindex: false, nofollow: false, hreflang: [], jsonldTypes: [], jsonldErrors: 0,
    wordCount: 600, imgNoAlt: 0, inlinks: 3, outlinks: 5, links: [], responseMs: 200, depth: 1, contentHash: `h${n}`, inSitemap: true,
    orphan: false, blocked: false, error: null, ...over,
  } as Page;
}
const ctx = { robotsTxt: "User-agent: *", sitemapCount: 10, site: "tienda.cl" };

test("4xx: la evidencia trae estado, sitemap y páginas que la enlazan", () => {
  const a = page({ url: `${S}/catalogo`, links: [`${S}/lineas-viejas`] });
  const gone = page({ url: `${S}/lineas-viejas`, status: 404, inSitemap: true });
  const i = computeIssues([a, gone], ctx).find((x) => x.code === "http_4xx")!;
  assert.equal(i.url, `${S}/lineas-viejas`);
  assert.match(i.detail!, /HTTP 404/);
  assert.match(i.detail!, /en sitemap/);
  assert.match(i.detail!, /enlazada desde https:\/\/tienda\.cl\/catalogo/);
  assert.match(httpEvidence({ url: `${S}/x`, finalUrl: `${S}/x`, status: 410, inSitemap: false }, []), /sin origen registrado/);
});

test("canonical: consolidar variantes en una ficha válida es intencional; a una URL rota es error", () => {
  const ficha = page({ url: `${S}/producto/traje-azul` });
  const variante = page({ url: `${S}/producto/traje-modelo-x-azul`, canonical: ficha.url, canonicalType: "other" });
  const issues = computeIssues([ficha, variante], ctx);
  assert.ok(issues.some((i) => i.code === "canonical_other"));
  const split = splitIntentional(issues, [ficha, variante]);
  assert.ok(!split.real.some((i) => i.code === "canonical_other"), "no es tarea");
  assert.ok(split.intentional.some((x) => x.code === "canonical_variant"));

  const rota = page({ url: `${S}/producto/viejo`, status: 404 });
  const mal = page({ url: `${S}/producto/otro`, canonical: rota.url, canonicalType: "other" });
  const bad = computeIssues([rota, mal], ctx).find((i) => i.code === "canonical_bad_target")!;
  assert.match(bad.detail!, /HTTP 404/);
});

test("noindex en URLs de filtro es intencional", () => {
  const f = page({ url: `${S}/catalogo?talla=m`, noindex: true, inSitemap: false });
  const issues = computeIssues([f], ctx);
  const split = splitIntentional(issues, [f]);
  assert.ok(!split.real.some((i) => i.code === "noindex"));
  assert.ok(split.intentional.some((x) => x.code === "noindex_filter"));
});

test("nofollow solo se reporta si la página es la única vía hacia otras URLs", () => {
  const filtro = page({ url: `${S}/catalogo?color=rojo`, nofollow: true, noindex: true, inSitemap: false, links: [`${S}/producto/a`, `${S}/producto/b`] });
  const cat = page({ url: `${S}/catalogo`, links: [`${S}/producto/a`] });
  const a = page({ url: `${S}/producto/a` }), b = page({ url: `${S}/producto/b` });
  const nf = computeIssues([filtro, cat, a, b], ctx).filter((i) => i.code === "nofollow");
  assert.equal(nf.length, 1);
  assert.match(nf[0].detail!, /1 URL solo enlazada/);
  assert.match(nf[0].detail!, /producto\/b/);
  // si todo lo que enlaza también se enlaza desde otra página, no hay pérdida demostrable
  const cat2 = page({ url: `${S}/catalogo`, links: [`${S}/producto/a`, `${S}/producto/b`] });
  assert.ok(!computeIssues([filtro, cat2, a, b], ctx).some((i) => i.code === "nofollow"));
});

test("huérfana es hipótesis (info), no error; poco texto solo por debajo de 100 palabras", () => {
  const o = computeIssues([page({ url: `${S}/lineas`, orphan: true })], ctx).find((i) => i.code === "orphan")!;
  assert.equal(o.severity, "info");
  const f = buildFindings([page({ url: `${S}/lineas` })], [o]).findings[0];
  assert.equal(f.kind, "possible");
  assert.ok(!computeIssues([page({ url: `${S}/a`, wordCount: 180 })], ctx).some((i) => i.code === "thin_content"));
  assert.ok(computeIssues([page({ url: `${S}/a`, wordCount: 40 })], ctx).some((i) => i.code === "thin_content"));
});

test("title largo se estima por ancho, no por 60 caracteres", () => {
  const narrow = "Lentes ilimitados, fijos, livianos y útiles | Tienda líder"; // 58 car. angostos
  assert.ok(serpWidthPx(narrow, 20) < TITLE_MAX_PX);
  const wide = "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM"; // 40 car. anchos
  assert.ok(serpWidthPx(wide, 20) > TITLE_MAX_PX);
  const t = page({ url: `${S}/a`, title: narrow + " extra", titleLen: narrow.length + 6 });
  assert.ok(!computeIssues([t], ctx).some((i) => i.code === "title_long"), "65 caracteres angostos no se cortan");
});

test("la confianza entra al puntaje", () => {
  const base = { title: "x", fix: "y", traffic: 100, trafficLabel: "", sev: 2, sevLabel: "", ease: 1 };
  assert.ok(makeTask({ ...base, confidence: "alta" }).score > makeTask({ ...base, confidence: "baja" }).score);
});

test("período GSC: 28 días que terminan en el último dato, y el anterior de igual largo", () => {
  const p = periodEndingAt(new Date("2026-10-12T00:00:00Z"));
  assert.equal(isoDay(p.start), "2026-09-15");
  assert.equal(isoDay(p.end), "2026-10-12");
  assert.equal(isoDay(p.endExclusive), "2026-10-13");
  assert.equal(isoDay(p.prevStart), "2026-08-18");
});

test("brief: descarta links a rutas inexistentes, filtros ya presentes y avisa afirmaciones sin respaldo", () => {
  const brief: Brief = {
    kind: "listing",
    titles: ["Trajes de natación | Taupoc"],
    metas: ["Trajes homologados con rendimiento óptimo y oferta infantil."],
    outline: [],
    intro: "Trajes homologados por World Aquatics.",
    filters: ["Talla", "Color", "Nivel de compresión"],
    links: [
      { anchor: "Trajes mujer", to: "/trajes-bano/mujer" },
      { anchor: "Líneas", to: "/lineas" },
      { anchor: "Accesorios", to: "otra categoría" },
    ],
    faq: [],
  };
  const out = verifyBrief(brief, {
    ownText: "Trajes homologados por World Aquatics. Filtrar por talla y color.",
    knownUrls: [`https://taupoc.cl/lineas/`, "https://taupoc.cl/catalogo"],
    base: "https://taupoc.cl/catalogo",
  });
  assert.deepEqual(out.links, [{ anchor: "Líneas", to: "/lineas" }]);
  assert.deepEqual(out.filters, ["Nivel de compresión"]);
  assert.deepEqual(out.metas, [], "la meta con afirmaciones sin respaldo se quita, no solo se avisa");
  assert.deepEqual(out.titles, ["Trajes de natación | Taupoc"]);
  const w = out.warnings!.join("\n");
  assert.match(w, /trajes-bano\/mujer/);
  assert.match(w, /rendimiento óptimo/);
  assert.match(w, /infantil/);
});

import { checkStructuredData, visibleNumbers } from "./audit/structured";
import { parseHtml } from "./audit/crawler";

test("datos estructurados: precio, moneda, stock y reseñas contra lo visible", () => {
  assert.ok(visibleNumbers("Precio $59.990 antes 69,990").has(59990));
  assert.ok(visibleNumbers("Total 19,99 €").has(19.99));
  const prod = (offers: any, extra: any = {}) => [{ "@type": "Product", name: "Traje", offers, ...extra }];
  assert.deepEqual(checkStructuredData(prod({ price: "59990", priceCurrency: "CLP", availability: "https://schema.org/InStock" }), "Traje $59.990 Agregar al carro"), []);
  assert.match(checkStructuredData(prod({ price: "64990", priceCurrency: "CLP" }), "Traje $59.990").join(), /64990.*no aparece/);
  assert.match(checkStructuredData(prod({ price: "59990" }), "$59.990").join(), /priceCurrency/);
  assert.match(checkStructuredData(prod({ price: "59990", priceCurrency: "CLP", availability: "InStock" }), "$59.990 Agotado").join(), /agotado/);
  assert.match(checkStructuredData(prod({ price: "59990", priceCurrency: "CLP" }, { aggregateRating: { ratingValue: 4.8 } }), "$59.990").join(), /reseñas visibles/);
  assert.match(checkStructuredData([{ "@type": "Product", name: "x" }], "").join(), /sin offers/);
  // variantes de un ProductGroup: basta con que se vea uno de los precios
  const group = [{ "@type": "ProductGroup", hasVariant: [{ offers: { price: 59990, priceCurrency: "CLP" } }, { offers: { price: 64990, priceCurrency: "CLP" } }] }];
  assert.deepEqual(checkStructuredData(group, "Desde $59.990"), []);
  // el JSON-LD no cuenta como texto visible
  const h = parseHtml(`<html><body><script type="application/ld+json">{"@type":"Product","offers":{"price":"70000","priceCurrency":"CLP"}}</script><main>Traje $59.990</main></body></html>`, "https://x.cl/p");
  assert.match(h.schemaIssues.join(), /70000/);
});

test("contenido que depende de JavaScript (solo con render)", () => {
  const p = page({ url: `${S}/catalogo`, jsLinks: 12, rawWordCount: 40, wordCount: 400 } as any);
  const i = computeIssues([p], ctx).find((x) => x.code === "js_dependent")!;
  assert.match(i.detail!, /12 links/);
  assert.match(i.detail!, /40 de 400 palabras/);
  assert.ok(!computeIssues([page({ url: `${S}/a`, rawWordCount: null } as any)], ctx).some((x) => x.code === "js_dependent"));
});
