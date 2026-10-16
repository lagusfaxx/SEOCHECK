import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "cheerio";
import { parseHtml } from "./audit/crawler";
import { parseRobots, robotsAllows } from "./audit/robots";
import { parseSitemap } from "./audit/sitemap";
import { mainHash, simhash, hamming } from "./audit/parse/dup";
import { extractCustom } from "./audit/parse/extract";
import { parseServerLogs } from "./pro/logs";
import {
  architectureAnalysis,
  ecommerceAnalysis,
  forecast,
  indexationAnalysis,
  perfAnalysis,
  revenueByQuery,
  serpAnalysis,
  soft404,
  structuredAnalysis,
} from "./pro/analysis";
import { checkStructuredData } from "./audit/structured";
import { signature } from "./pro/notifications";
import type {
  Page,
  UrlInspection,
  PsiResult,
  SerpSnapshot,
} from "@prisma/client";
const page = (props: Partial<Page> = {}): Page =>
  ({
    url: "https://taupoc.cl/a",
    title: "Una página",
    h1: ["Una página"],
    status: 200,
    depth: 1,
    wordCount: 500,
    links: [],
    linkDetails: [],
    structured: {},
    commerce: {},
    images: [],
    jsonldErrors: 0,
    schemaIssues: [],
    noindex: false,
    canonicalType: "self",
    blocked: false,
    error: null,
    template: "article",
    inlinks: 1,
    ...props,
  }) as Page;

test("robots: aplica el user-agent configurado y combina grupos igualmente específicos", () => {
  const rules =
    "User-agent: Googlebot\nDisallow: /google\nUser-agent: SEOCheckBot\nDisallow: /privado\nUser-agent: SEOCheckBot\nAllow: /privado/publico\nUser-agent: *\nDisallow: /todo";
  const ours = parseRobots(rules, "Mozilla/5.0 (SEOCheckBot/1.0)");
  assert.equal(robotsAllows(ours, "https://taupoc.cl/privado"), false);
  assert.equal(robotsAllows(ours, "https://taupoc.cl/privado/publico"), true);
  assert.equal(robotsAllows(ours, "https://taupoc.cl/google"), true);
  assert.equal(
    robotsAllows(parseRobots(rules), "https://taupoc.cl/google"),
    false,
  );
});
test("parser conserva contexto de enlaces, datos de producto y extracción", () => {
  const p = parseHtml(
    `<html><head><title>Taza</title><script type="application/ld+json">{"@type":"Product","name":"Taza","sku":"T1","image":"/x.jpg","offers":{"@type":"Offer","price":1000,"priceCurrency":"CLP","availability":"https://schema.org/OutOfStock"}}</script></head><body><nav><a href="/cuenta">Cuenta</a></nav><main><h1>Taza</h1><p>Sin stock. Precio $1.000</p><span data-sku="T1">Código</span><a href="/otra">Otra taza</a><img src="/x.jpg" alt="Taza" width="300" height="300"></main></body></html>`,
    "https://taupoc.cl/products/taza",
    {
      extract: [
        { name: "sku", type: "css", selector: "[data-sku]", attr: "data-sku" },
      ],
    },
  );
  assert.equal(p.parsedExtra.template, "product");
  assert.equal(p.parsedExtra.commerce.price, 1000);
  assert.equal(p.parsedExtra.commerce.sku, "T1");
  assert.equal(p.parsedExtra.linkDetails[0].zone, "nav");
  assert.equal(p.parsedExtra.linkDetails[1].zone, "content");
  assert.deepEqual(p.parsedExtra.extracted.sku, ["T1"]);
  assert.equal(p.parsedExtra.images[0].alt, "Taza");
  assert.ok(p.parsedExtra.structured.jsonld.some((e) => e.type === "Offer"));
});
test("extracción CSS y XPath simple con atributos; rechaza XPath no soportado", () => {
  const html = '<main><span class="sku" data-id="123">Taza</span></main>',
    $ = load(html);
  assert.deepEqual(
    extractCustom(html, $, [
      {
        name: "code",
        type: "xpath",
        selector: "//span[@class='sku']/@data-id",
      },
    ]),
    { code: ["123"] },
  );
  assert.throws(
    () =>
      extractCustom(html, $, [
        {
          name: "bad",
          type: "xpath",
          selector: "//span[contains(text(),'x')]",
        },
      ]),
    /XPath/,
  );
  assert.throws(
    () =>
      extractCustom(html, $, [
        { name: "bad", type: "regex", selector: "(a+)+$" },
      ]),
    /segura/,
  );
});
test("simhash: textos iguales, distintos y hash sin navegación", () => {
  const text =
    "Un producto útil para preparar café en casa con una taza de cerámica resistente y de color azul ".repeat(
      5,
    );
  assert.equal(mainHash("texto"), mainHash(" TEXTO "));
  assert.equal(hamming(simhash(text)!, simhash(text)!), 0);
  assert.ok(
    hamming(
      simhash(text)!,
      simhash(
        "Un análisis político de elecciones internacionales y economía global ".repeat(
          7,
        ),
      )!,
    ) > 3,
  );
  assert.equal(simhash("muy corto"), null);
});
test("sitemap: conserva lastmod y entidades XML; distingue índices y errores", () => {
  const r = parseSitemap(
    "<urlset><url><loc>https://taupoc.cl/a?a=1&amp;b=2</loc><lastmod>2026-01-02</lastmod></url><url><loc>javascript:alert(1)</loc></url></urlset>",
    "https://taupoc.cl/sitemap.xml",
  );
  assert.equal(r.entries[0].url, "https://taupoc.cl/a?a=1&b=2");
  assert.equal(r.entries[0].lastmod, "2026-01-02T00:00:00.000Z");
  assert.equal(r.invalid.length, 1);
  assert.deepEqual(
    parseSitemap(
      "<sitemapindex><sitemap><loc>https://taupoc.cl/2.xml</loc></sitemap></sitemapindex>",
      "x",
    ).children,
    ["https://taupoc.cl/2.xml"],
  );
});
test("soft 404 es señal de contenido y no marca fichas normales", () => {
  assert.equal(
    soft404(page({ title: "Página no encontrada", h1: [], wordCount: 12 })),
    true,
  );
  assert.equal(
    soft404(page({ title: "Producto 404 ml", wordCount: 800 })),
    false,
  );
});
test("indexación: sitemap no equivale a indexada y la inspección más reciente manda", () => {
  const p = page({ inSitemap: true }),
    old = {
      url: p.url,
      verdict: "PASS",
      coverageState: "Indexed",
      createdAt: new Date("2026-01-01"),
    } as UrlInspection,
    cur = {
      ...old,
      verdict: "FAIL",
      coverageState: "Excluded by noindex",
      createdAt: new Date("2026-01-02"),
    };
  const r = indexationAnalysis([p], [cur, old], []);
  assert.match(String(r.rows[0].motivo), /noindex/);
  assert.match(
    String(indexationAnalysis([p], [], []).rows[0].estadoGoogle),
    /Desconocido/,
  );
});
test("arquitectura: sugiere solo enlaces que faltan entre páginas relacionadas", () => {
  const a = page({
      title: "Tazas cerámica azul",
      h1: [],
      links: [],
      inlinks: 0,
    }),
    b = page({
      url: "https://taupoc.cl/b",
      title: "Guía de tazas cerámica",
      h1: [],
      inlinks: 4,
    });
  const r = architectureAnalysis([a, b]);
  assert.ok(
    r.rows.some(
      (r) =>
        r.tipo === "Propuesta de enlace interno" &&
        r.desde === b.url &&
        r.url === a.url,
    ),
  );
  b.links = [a.url];
  assert.ok(
    !architectureAnalysis([a, b]).rows.some(
      (r) => r.desde === b.url && r.url === a.url,
    ),
  );
});
test("ecommerce: stock indexable y canonical conservador", () => {
  const p = page({
    template: "product",
    commerce: { availability: "https://schema.org/OutOfStock" },
  });
  assert.equal(ecommerceAnalysis([p]).rows.length, 1);
  assert.equal(ecommerceAnalysis([{ ...p, noindex: true }]).rows.length, 0);
});
test("FAQ y Breadcrumb se comprueban contra texto visible", () => {
  const issues = checkStructuredData(
    [
      {
        "@type": "FAQPage",
        mainEntity: [
          {
            name: "¿Tiene garantía?",
            acceptedAnswer: { text: "Garantía de por vida" },
          },
        ],
      },
      { "@type": "BreadcrumbList", itemListElement: [{ name: "Cafeteras" }] },
    ],
    "Tazas de cerámica",
  );
  assert.ok(issues.some((s) => s.includes("FAQ")));
  assert.ok(issues.some((s) => s.includes("Breadcrumb")));
  assert.ok(
    structuredAnalysis([
      page({
        structured: {
          jsonld: [{ type: "Offer", format: "jsonld", props: { price: 1000 } }],
        },
      }),
    ]).rows.some((r) => String(r.detalle).includes("priceCurrency")),
  );
});
test("CrUX de origen no se etiqueta como dato de plantilla; no inventa INP de TBT", () => {
  const psi = {
    url: "https://taupoc.cl/a",
    strategy: "mobile",
    field: { source: "origin", lcp: { p75: 1800 } },
    lab: { tbt: 200 },
    createdAt: new Date(),
  } as unknown as PsiResult;
  const row = perfAnalysis([page()], [psi]).rows[0];
  assert.match(String(row.fuente), /no atribuible/);
  assert.equal(row.inpCampo, null);
});
test("featured snippet: detecta cambio pero no atribuye propiedad al dominio", () => {
  const snap = (date: string, features: string[]) =>
    ({ keyword: "taza", features, fetchedAt: new Date(date) }) as SerpSnapshot;
  assert.equal(
    serpAnalysis([snap("2026-01-02", ["snippet"]), snap("2026-01-01", [])])
      .rows[0].cambioSnippet,
    "Apareció",
  );
});
test("ingresos estimados se reconcilian por landing y día; no asigna fechas ajenas", () => {
  const day = new Date("2026-01-01"),
    next = new Date("2026-01-02");
  const result = revenueByQuery(
    [
      { date: day, page: "https://taupoc.cl/a/", query: "taza", clicks: 3 },
      { date: day, page: "https://taupoc.cl/a", query: "taza azul", clicks: 1 },
      {
        date: next,
        page: "https://taupoc.cl/a",
        query: "otro día",
        clicks: 30,
      },
    ],
    [
      { date: day, landing: "/a", revenue: 100, sessions: 20 },
      { date: day, landing: "/sin-dato", revenue: 20, sessions: 1 },
    ],
  );
  assert.deepEqual(
    result.rows.map((r) => r.ingresoEstimado),
    [75, 25],
  );
  assert.equal(result.unallocated, 20);
  assert.ok(!result.rows.some((r) => r.consulta === "otro día"));
});
test("pronóstico requiere 28 días contiguos, no un período con huecos", () => {
  const days = Array.from({ length: 28 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
    clicks: 10,
  }));
  assert.equal(forecast(days)?.next28Days, 280);
  assert.equal(forecast(days.slice(0, 20)), null);
  days[15].date = "2026-02-02";
  assert.equal(forecast(days), null);
});
test("logs: cuenta bots declarados y errores, sin conservar IP ni query", () => {
  const r = parseServerLogs(
    '203.0.113.10 - - [10/Oct/2026:13:55:36 +0000] "GET /cart?email=secret@example.cl HTTP/1.1" 404 2326 "-" "Googlebot/2.1"\ninvalid',
  );
  assert.equal(r.parsed, 1);
  assert.equal(r.invalid, 1);
  assert.equal(r.wasted, 1);
  assert.equal(r.verified, false);
  assert.equal(r.topUrls[0].path, "/cart");
  assert.ok(!JSON.stringify(r).includes("203.0.113"));
  assert.ok(!JSON.stringify(r).includes("secret@"));
});
test("webhooks: firma liga el cuerpo exacto y el secreto", () => {
  const s = signature("secret", '{"a":1}');
  assert.match(s, /^sha256=[a-f0-9]{64}$/);
  assert.notEqual(s, signature("other", '{"a":1}'));
  assert.notEqual(s, signature("secret", '{"a":2}'));
});

import { ga4Properties, matchingProperties, parseReport } from "./ga4";
test("Analytics Admin: recorre páginas de cuentas y flujos y filtra taupoc.cl", async () => {
  const calls: string[] = [];
  const client = {
    request: async (o: any) => {
      calls.push(o.url + "|" + (o.params?.pageToken ?? ""));
      if (o.url.endsWith("accountSummaries")) {
        return {
          data: o.params?.pageToken
            ? {
                accountSummaries: [
                  {
                    displayName: "Cuenta B",
                    propertySummaries: [
                      { property: "properties/2", displayName: "Otra" },
                    ],
                  },
                ],
              }
            : {
                accountSummaries: [
                  {
                    displayName: "Cuenta A",
                    propertySummaries: [
                      { property: "properties/1", displayName: "Taupoc" },
                    ],
                  },
                ],
                nextPageToken: "accounts-2",
              },
        };
      }
      if (o.url.includes("properties/1"))
        return {
          data: o.params?.pageToken
            ? {
                dataStreams: [
                  { webStreamData: { defaultUri: "https://www.taupoc.cl" } },
                ],
              }
            : {
                dataStreams: [{ type: "ANDROID_APP_DATA_STREAM" }],
                nextPageToken: "streams-2",
              },
        };
      return {
        data: {
          dataStreams: [{ webStreamData: { defaultUri: "https://tacos.cl" } }],
        },
      };
    },
  };
  const props = await ga4Properties("unused", client as any);
  assert.equal(props.length, 2);
  assert.ok(calls.some((s) => s.endsWith("|accounts-2")));
  assert.ok(calls.some((s) => s.endsWith("|streams-2")));
  assert.deepEqual(
    matchingProperties(props, "taupoc.cl").map((p) => p.property),
    ["properties/1"],
  );
});
test("Analytics: error al leer flujos no se presenta como dominio comprobado", async () => {
  const client = {
    request: async (o: any) => {
      if (o.url.endsWith("accountSummaries"))
        return {
          data: {
            accountSummaries: [
              {
                displayName: "A",
                propertySummaries: [
                  { property: "properties/1", displayName: "P" },
                ],
              },
            ],
          },
        };
      throw Object.assign(new Error("Denied"), { response: { status: 403 } });
    },
  };
  const props = await ga4Properties("unused", client as any);
  assert.equal(props[0].sites.length, 0);
  assert.match(props[0].streamError ?? "", /permiso/);
});
test("GA4: landing no identificada no se suma a la portada", () => {
  const r = parseReport([
    {
      dimensionValues: [{ value: "20261001" }, { value: "(not set)" }],
      metricValues: [{ value: "5" }, { value: "1" }, { value: "100" }],
    },
  ]);
  assert.equal(r[0].landing, "(not set)");
  assert.equal(
    revenueByQuery(
      [
        {
          date: new Date("2026-10-01"),
          page: "https://taupoc.cl/",
          query: "marca",
          clicks: 5,
        },
      ],
      r.map((x) => ({ ...x, date: new Date(x.date) })),
    ).unallocated,
    100,
  );
});
import { ga4OrganicFilter } from "./ga4";
test("GA4: filtro orgánico limita hosts al dominio del proyecto", () => {
  const f = ga4OrganicFilter("taupoc.cl");
  const regex = f.andGroup.expressions[1].filter.stringFilter.value;
  assert.ok(new RegExp(`^(?:${regex})$`, "i").test("www.taupoc.cl"));
  assert.ok(!new RegExp(`^(?:${regex})$`, "i").test("taupoc.cl.evil.com"));
  assert.ok(!new RegExp(`^(?:${regex})$`, "i").test("tacos.cl"));
});

import { extractStructured } from "./audit/parse/structured";
import { commerceSignals } from "./audit/parse/commerce";
import { PRO_MODULES, PRO_GETS } from "./pro";
test("microdatos anidados conservan Offer y normalizan RDFa",()=>{
 const $=load('<main itemscope itemtype="https://schema.org/Product"><span itemprop="name">Taza</span><span itemprop="offers" itemscope itemtype="https://schema.org/Offer"><meta itemprop="price" content="1000"><meta itemprop="priceCurrency" content="CLP"><link itemprop="availability" href="https://schema.org/OutOfStock"></span></main><div typeof="schema:FAQPage"><meta property="schema:name" content="Preguntas"></div>');const parsed=extractStructured($,[]);const commerce=commerceSignals($,"https://taupoc.cl/taza",parsed);assert.equal(commerce.price,1000);assert.equal(commerce.availability,"https://schema.org/OutOfStock");assert.equal(parsed.rdfa[0].props.name,"Preguntas");
});
test("todos los módulos expertos montan una lectura funcional sin prefijos repetidos",()=>{const prefixes=PRO_MODULES.map(m=>m.prefix);assert.equal(new Set(prefixes).size,13);for(const prefix of prefixes)assert.equal(typeof PRO_GETS[`pro/${prefix}`],"function");});
test("schema: Breadcrumb y FAQ permiten una entidad única y nombres dentro de item",()=>{const p=page({structured:{jsonld:[{format:"jsonld",type:"BreadcrumbList",props:{itemListElement:{position:1,item:{name:"Inicio", "@id":"https://taupoc.cl/"}}}},{format:"jsonld",type:"FAQPage",props:{mainEntity:{name:"¿Color?",acceptedAnswer:{text:"Azul"}}}}]}});assert.equal(structuredAnalysis([p]).rows.length,0);});
