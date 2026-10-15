import { test } from "node:test";
import assert from "node:assert/strict";
import { changeAlerts, clickDrop, diffCrawls, robotsBlocksAll, type PageSnap } from "./watch";

const S = "https://x.cl";
const pg = (path: string, over: Partial<PageSnap> = {}): PageSnap => ({ url: `${S}${path}`, status: 200, title: `T ${path}`, canonical: `${S}${path}`, noindex: false, h1: [`H ${path}`], ...over });

test("cambios entre crawls por URL", () => {
  const prev = [pg("/a"), pg("/b"), pg("/c"), pg("/d")];
  const cur = [pg("/a", { noindex: true }), pg("/b", { status: 404 }), pg("/c", { title: "Otro" })];
  const ch = diffCrawls(prev, cur, true);
  assert.deepEqual(ch.map((c) => `${c.field}:${c.url.slice(S.length)}`).sort(), ["gone:/d", "noindex:/a", "status:/b", "title:/c"]);
  assert.ok(!diffCrawls(prev, cur, false).some((c) => c.field === "gone"), "crawl parcial: no se afirma que desapareció");
});

test("avisos: solo páginas con tráfico, y cambios masivos", () => {
  const impr = new Map([["x.cl/a", 100], ["x.cl/b", 50]]);
  const ch = diffCrawls([pg("/a"), pg("/b"), pg("/z")], [pg("/a", { noindex: true }), pg("/b", { status: 500 }), pg("/z", { noindex: true })], true);
  const a = changeAlerts(ch, impr);
  assert.deepEqual(a.map((x) => x.key).sort(), ["broken-new", "noindex-new"]);
  assert.deepEqual(a.find((x) => x.key === "noindex-new")!.urls, [`${S}/a`], "/z no tiene tráfico");
  const prev = Array.from({ length: 12 }, (_, i) => pg(`/p${i}`));
  const cur = prev.map((p) => ({ ...p, canonical: `${S}/` }));
  assert.equal(changeAlerts(diffCrawls(prev, cur, true), new Map())[0].key, "mass-canonical");
});

test("robots.txt que bloquea todo y caída de clics", () => {
  assert.ok(robotsBlocksAll("User-agent: *\nDisallow: /"));
  assert.ok(robotsBlocksAll("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nAllow: /"));
  assert.ok(!robotsBlocksAll("User-agent: *\nDisallow: /carrito"));
  assert.ok(!robotsBlocksAll("User-agent: Bingbot\nDisallow: /"));
  assert.ok(clickDrop(50, 100));
  assert.ok(!clickDrop(70, 100), "-30 % no alcanza el umbral");
  assert.ok(!clickDrop(5, 20), "base chica: no avisa");
});
