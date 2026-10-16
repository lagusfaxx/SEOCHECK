import { test } from "node:test";
import assert from "node:assert/strict";
import { authHeaders, pathMatches, renderDiff } from "./audit/crawler";
import { canonicalLoop, robotsConflict } from "./audit/issues";
import { robotsDiff, siteMonitorAlerts } from "./watch";
import { parseServerLogs, verifyBots } from "./pro/logs";
import { RedirectLoopError, safeFetch } from "./net/ssrf";

const parsed = (o: Partial<Parameters<typeof renderDiff>[0]> = {}) => ({ title: "A", metaDesc: "d", h1: ["A"], canonical: "https://x.cl/a", noindex: false, nofollow: false, links: ["https://x.cl/b"], wordCount: 300, ...o });

test("render por sección: patrones con * y prefijos", () => {
  assert.ok(pathMatches("https://x.cl/productos/taza", ["/productos/*"]));
  assert.ok(pathMatches("https://x.cl/blog/nota", ["/blog/"]));
  assert.ok(pathMatches("https://x.cl/lineas", ["/lineas"]));
  assert.ok(!pathMatches("https://x.cl/lineas-nuevas", ["/lineas"]));
  assert.ok(!pathMatches("https://x.cl/otra", ["/productos/*"]));
  assert.ok(pathMatches("https://x.cl/lo-que-sea", ["*"]));
});

test("HTML vs DOM renderizado: reporta solo lo que cambia", () => {
  assert.deepEqual(renderDiff(parsed(), parsed()), []);
  const d = renderDiff(parsed({ noindex: true, links: [] }), parsed({ title: "B", canonical: "https://x.cl/c", wordCount: 400, links: ["https://x.cl/b", "https://x.cl/z"] }));
  const fields = d.map((x) => x.field);
  assert.deepEqual(fields.sort(), ["canonical", "links", "meta_robots", "title"].sort());
  assert.match(d.find((x) => x.field === "meta_robots")!.html, /noindex/);
  const text = renderDiff(parsed({ wordCount: 50 }), parsed({ wordCount: 400 }));
  assert.ok(text.some((x) => x.field === "text"));
});

test("credenciales de staging: Basic, cookie y cabeceras sin saltos de línea", () => {
  const h = authHeaders({ user: "qa", pass: "s3cr3t", cookie: "sid=1", headers: { "X-Env": "staging", "Bad Header": "x", "X-Inject": "a\r\nb" } });
  assert.equal(h.Authorization, `Basic ${Buffer.from("qa:s3cr3t").toString("base64")}`);
  assert.equal(h.Cookie, "sid=1");
  assert.equal(h["X-Env"], "staging");
  assert.equal(h["Bad Header"], undefined);
  assert.equal(h["X-Inject"], undefined);
});

test("canonicals en bucle y contradicciones de robots", () => {
  const pageOf = new Map([
    ["https://x.cl/a", { canonical: "https://x.cl/b", canonicalType: "other" }],
    ["https://x.cl/b", { canonical: "https://x.cl/a", canonicalType: "other" }],
    ["https://x.cl/c", { canonical: "https://x.cl/d", canonicalType: "other" }],
    ["https://x.cl/d", { canonical: "https://x.cl/d", canonicalType: "self" }],
  ]);
  assert.deepEqual(canonicalLoop("https://x.cl/a", pageOf), ["https://x.cl/a", "https://x.cl/b", "https://x.cl/a"]);
  assert.equal(canonicalLoop("https://x.cl/c", pageOf), null);
  const base = { noindex: false, canonicalType: "self", canonical: "https://x.cl/a" };
  assert.match(robotsConflict({ ...base, robotsMeta: "index, follow", xRobots: "noindex", noindex: true })!, /se contradicen/);
  assert.equal(robotsConflict({ ...base, robotsMeta: "index, follow", xRobots: "bingbot: noindex" }), null);
  // noindex + canonical a otra URL ya no es «contradicción confirmada»: va como hipótesis aparte
  assert.equal(robotsConflict({ ...base, robotsMeta: "noindex", xRobots: null, noindex: true, canonicalType: "other", canonical: "https://x.cl/b" }), null);
  assert.equal(robotsConflict({ ...base, robotsMeta: "noindex, follow", xRobots: null, noindex: true }), null);
});

test("monitor del sitio: robots.txt, tamaño del sitemap y páginas críticas", () => {
  assert.deepEqual(robotsDiff("User-agent: *\nDisallow: /cart", "User-agent: *\nDisallow: /cart\nDisallow: /blog # nuevo"), { added: ["Disallow: /blog"], removed: [] });
  const alerts = siteMonitorAlerts({
    prevRobots: "User-agent: *\nDisallow: /cart",
    curRobots: "User-agent: *\nDisallow: /cart\nDisallow: /blog",
    prevSitemap: 100,
    curSitemap: 60,
    changes: [
      { url: "https://x.cl/categoria", field: "canonical", before: "https://x.cl/categoria", after: "https://x.cl/" },
      { url: "https://x.cl/otra", field: "noindex", before: "index", after: "noindex" },
    ],
    critical: ["https://x.cl/", "https://x.cl/categoria"],
  });
  const keys = Object.fromEntries(alerts.map((a) => [a.key, a]));
  assert.equal(keys["robots-changed"].severity, "critical");
  assert.equal(keys["sitemap-size"].severity, "critical");
  assert.deepEqual(keys["critical-pages"].urls, ["https://x.cl/categoria"]);
  // sin robots anterior (primer crawl) o con un sitemap chico no hay ruido
  assert.equal(siteMonitorAlerts({ prevRobots: null, curRobots: "x", prevSitemap: 5, curSitemap: 1, changes: [], critical: [] }).length, 0);
});

test("logs: Googlebot se verifica por DNS inverso y directo; los impostores se cuentan aparte", async () => {
  const line = (ip: string, ua: string) => `${ip} - - [16/Oct/2026:10:00:00 +0000] "GET /a HTTP/1.1" 200 10 "-" "${ua}"`;
  const input = [line("66.249.66.1", "Googlebot/2.1"), line("66.249.66.1", "Googlebot/2.1"), line("1.2.3.4", "Googlebot/2.1"), line("5.6.7.8", "GPTBot/1.0"), line("9.9.9.9", "Mozilla/5.0")].join("\n");
  const ips = new Map<string, Map<string, number>>();
  const stats = parseServerLogs(input, ips);
  assert.equal(stats.bots.googlebot, 3);
  assert.ok(!JSON.stringify(stats).includes("66.249.66.1"), "el resumen no guarda IP");
  const resolver = {
    reverse: async (ip: string) => (ip === "66.249.66.1" ? ["crawl-66-249-66-1.googlebot.com"] : ip === "1.2.3.4" ? ["evil.example.com"] : []),
    lookup: async (host: string) => (host === "crawl-66-249-66-1.googlebot.com" ? ["66.249.66.1"] : []),
  };
  const v = await verifyBots(ips, resolver);
  assert.deepEqual({ verified: v.googlebot.verified, fake: v.googlebot.fake, vr: v.googlebot.verifiedRequests, fr: v.googlebot.fakeRequests }, { verified: 1, fake: 1, vr: 2, fr: 1 });
  assert.equal(v.gptbot.checked, 0);
  assert.match(v.gptbot.note!, /no publica/);
});

test("safeFetch detecta bucles de redirección y no reenvía credenciales a otro host", async () => {
  const seenAuth: Record<string, string | null> = {};
  const fetchImpl = (async (url: string, init: any) => {
    seenAuth[url] = (init.headers ?? {}).Authorization ?? null;
    const loc: Record<string, string> = { "https://93.184.216.34/a": "https://93.184.216.34/b", "https://93.184.216.34/b": "https://93.184.216.34/a" };
    return new Response(null, { status: 301, headers: { location: loc[url] ?? "https://8.8.8.8/x" } });
  }) as any;
  await assert.rejects(safeFetch("https://93.184.216.34/a", { fetchImpl }), (e: unknown) => e instanceof RedirectLoopError && /\/a \(301\) → .*\/b \(301\) → .*\/a/.test((e as Error).message));
  const ok = (async (url: string, init: any) => {
    seenAuth[url] = (init.headers ?? {}).Authorization ?? null;
    return url.includes("93.184.216.34") ? new Response(null, { status: 302, headers: { location: "https://8.8.8.8/fin" } }) : new Response("ok", { status: 200 });
  }) as any;
  await safeFetch("https://93.184.216.34/inicio", { fetchImpl: ok, headers: { Authorization: "Basic x" } });
  assert.equal(seenAuth["https://93.184.216.34/inicio"], "Basic x");
  assert.equal(seenAuth["https://8.8.8.8/fin"], null);
});

test("keyword gap: descarta keywords de otro rubro aunque compartan «mujer» u «hombre»", async () => {
  const { relevantGap } = await import("./keyword-gap");
  const vocab = ["Traje de Natación R-Skin Jammer | Taupoc", "Trajes de baño de competencia para mujer", "taupoc swimwear"];
  const items = ["new balance", "zapatillas nike mujer", "polerones hombre", "trajes de baño mujer", "traje de natacion competencia", "jammer natacion"].map((keyword) => ({ keyword }));
  const { relevant, discarded } = relevantGap(items, vocab);
  assert.deepEqual(relevant.map((i) => i.keyword), ["trajes de baño mujer", "traje de natacion competencia", "jammer natacion"]);
  assert.equal(discarded.length, 3);
});

test("informe ejecutivo: el mismo problema en dos secciones se distingue por sección", async () => {
  const { withSection } = await import("./reporting");
  const out = withSection([
    { title: "Título que puede cortarse", pattern: "/producto/*" },
    { title: "Título que puede cortarse", pattern: null },
    { title: "Sin H1", pattern: null },
  ]);
  assert.deepEqual(out.map((a) => a.title), ["Título que puede cortarse · /producto/*", "Título que puede cortarse · varias secciones", "Sin H1"]);
});

test("pasos sugeridos: la evidencia es URL + valor observado, no el texto completo de la tarea", async () => {
  const { evidenceOf } = await import("./advice/plan");
  const reason = "Directivas contradictorias: Google aplica la más restrictiva. Evidencia (2026-10-16): noindex y canonical a https://taupoc.cl/catalogo: señales opuestas. Dejar una sola directiva. Prioridad: 38 enlaces internos (sin datos GSC) × severidad warning.";
  assert.equal(evidenceOf({ url: "https://taupoc.cl/x", reason }), "https://taupoc.cl/x — noindex y canonical a https://taupoc.cl/catalogo: señales opuestas");
  assert.equal(evidenceOf({ url: "https://taupoc.cl/y", reason: "Sin evidencia." }), "https://taupoc.cl/y");
});
