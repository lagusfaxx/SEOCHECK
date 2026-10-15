import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeGap, peakMonths, upcomingPeaks } from "./keyword-gap";
import { monthlyOf } from "./volume/dataforseo";

const item = (keyword: string, volume: number, pos: number, monthly?: any[]) => ({ keyword_data: { keyword, keyword_info: { search_volume: volume, monthly_searches: monthly } }, first_domain_serp_element: { rank_absolute: pos, url: `https://c.cl/${keyword}` } });

test("gap: une competidores por keyword, mejor posición primero, ordena por volumen", () => {
  const g = mergeGap([
    { domain: "a.cl", items: [item("trajes", 900, 8), item("gorros", 300, 3)] },
    { domain: "b.cl", items: [item("trajes", 900, 2)] },
  ]);
  assert.deepEqual(g.map((x) => x.keyword), ["trajes", "gorros"]);
  assert.deepEqual(g[0].competitors.map((c) => c.domain), ["b.cl", "a.cl"]);
});

test("estacionalidad: meses pico y lo que se viene", () => {
  const monthly = Array.from({ length: 12 }, (_, i) => ({ year: 2026, month: i + 1, volume: [12, 1, 2].includes(i + 1) ? 300 : 100 }));
  assert.deepEqual(peakMonths(monthly), [1, 2, 12]);
  assert.deepEqual(peakMonths(Array.from({ length: 12 }, (_, i) => ({ year: 2026, month: i + 1, volume: 100 }))), []);
  assert.deepEqual(peakMonths(monthly.slice(0, 3)), [], "con menos de 6 meses no concluye");
  const up = upcomingPeaks([{ monthly }, { monthly: null }], new Date(Date.UTC(2026, 10, 15))); // noviembre → dic, ene
  assert.equal(up.length, 1);
  assert.deepEqual(monthlyOf([{ year: 2026, month: 2, search_volume: 5 }, { year: 2026, month: 1, search_volume: null }, { year: 2025, month: 12, search_volume: 9 }]), [{ year: 2025, month: 12, volume: 9 }, { year: 2026, month: 2, volume: 5 }]);
});
