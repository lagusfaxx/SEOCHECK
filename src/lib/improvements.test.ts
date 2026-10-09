import { test } from "node:test";
import assert from "node:assert/strict";
import { improvements, LEVEL_DOT, levelOf, maxPoints, type Improvement } from "./content/improvements";

/** Análisis coherente con analyze.ts: los puntos salen de las mismas listas. */
function fixture(o: { missTerms?: number; termsPts?: number; secs?: number; missSecs?: number; paa?: number; missPaa?: number; schemaMiss?: boolean; words?: number; target?: number; pageType?: string } = {}) {
  const max = maxPoints(o.pageType);
  const secs = o.secs ?? 4, missSecs = o.missSecs ?? 0, paa = o.paa ?? 3, missPaa = o.missPaa ?? 0;
  const words = o.words ?? 900, target = o.target ?? 1000;
  const sections = Array.from({ length: secs }, (_, i) => ({ label: `Sección ${i}`, covered: i >= missSecs }));
  const paaL = Array.from({ length: paa }, (_, i) => ({ q: `¿Pregunta ${i}?`, answered: i >= missPaa }));
  const competitors = Array.from({ length: 10 }, () => ({}));
  const schema = [{ type: "Product", count: 8, mine: !o.schemaMiss }];
  return {
    pageType: o.pageType,
    terms: Array.from({ length: 40 }, (_, i) => ({ missing: i < (o.missTerms ?? 0) })),
    sections, paa: paaL, schema, competitors,
    mine: { editorial: words }, targetWords: target,
    breakdown: {
      terms: o.termsPts ?? Math.round((1 - (o.missTerms ?? 0) / 40) * max.terms),
      sections: Math.round((secs ? (secs - missSecs) / secs : 1) * max.sections),
      paa: Math.round((paa ? (paa - missPaa) / paa : 1) * 15),
      schema: o.schemaMiss ? 0 : 10,
      length: Math.round(Math.min(1, words / (target * 0.9)) * 15),
    },
  };
}

/** Invariantes que nunca deben romperse, para cualquier ítem. */
function check(items: Improvement[], label: string) {
  for (const it of items) {
    const ctx = `${label} · ${it.area}: ${it.title} (${it.points}/${it.max}, ${it.level})`;
    assert.ok(LEVEL_DOT[it.level], ctx);
    if (it.level === "pending") {
      assert.match(it.title, /^(Pendiente|Sin datos)$/, ctx);
      continue;
    }
    assert.equal(typeof it.points, "number", ctx);
    assert.equal(it.level, levelOf(it.points!, it.max), `color/estado sale de los puntos · ${ctx}`);
    if (it.points === 0) assert.notEqual(it.level, "good", `0 puntos nunca es verde · ${ctx}`);
    if (it.level === "good") assert.ok(it.points! / it.max >= 0.8, ctx);
    if (/completa|correct|cubiertas|Cubres/.test(it.title) && !/Casi/.test(it.title)) assert.equal(it.level, "good", `texto positivo ⇒ verde · ${ctx}`);
    if (/^Falta/.test(it.title)) {
      const k = Number((it.title.match(/\d+/) ?? it.detail.match(/\d+/) ?? ["0"])[0]);
      assert.ok(k > 0 || /«/.test(it.detail), `«Falta…» con 0 faltantes · ${ctx}`);
      assert.notEqual(it.level, "good", ctx);
    }
    assert.doesNotMatch(it.detail, /(^|\s)0 (término|sección|pregunta)/, `nunca «0 …» como faltante · ${ctx}`);
  }
}

test("invariantes en una grilla de casos coherentes", () => {
  let i = 0;
  for (const missTerms of [0, 3, 20, 40])
    for (const [secs, missSecs] of [[0, 0], [4, 0], [5, 1], [4, 2], [4, 4]])
      for (const [paa, missPaa] of [[0, 0], [3, 0], [3, 1], [3, 3]])
        for (const schemaMiss of [false, true])
          for (const words of [100, 950, 2000])
            for (const pageType of [undefined, "listing"]) {
              check(improvements(fixture({ missTerms, secs, missSecs, paa, missPaa, schemaMiss, words, pageType })), `caso ${i++}`);
            }
});

test("nunca «Faltan temas importantes» con 0 términos faltantes", () => {
  const it = improvements(fixture({ missTerms: 0, termsPts: 10 })).find((x) => x.area === "Contenido")!;
  assert.equal(it.level, "bad");
  assert.doesNotMatch(it.title, /Falta/);
  assert.equal(it.title, "Temas poco desarrollados");
  const withMiss = improvements(fixture({ missTerms: 39, termsPts: 10 })).find((x) => x.area === "Contenido")!;
  assert.equal(withMiss.title, "Faltan temas importantes");
  assert.match(withMiss.detail, /^39 términos relevantes/);
});

test("nunca verde con 0 puntos: datos incoherentes se muestran como «Sin datos»", () => {
  const r = fixture({ secs: 0 });
  r.breakdown.sections = 0; // sin secciones en común el score da puntaje completo; 0 es incoherente
  const it = improvements(r).find((x) => x.area === "Estructura")!;
  assert.equal(it.level, "pending");
  assert.equal(it.title, "Sin datos");
  const r2 = fixture({ paa: 3, missPaa: 0 });
  r2.breakdown.paa = 0;
  assert.equal(improvements(r2).find((x) => x.area === "Preguntas")!.level, "pending");
});

test("mientras carga o sin datos: «Pendiente» / «Sin datos», nunca 0 como resultado", () => {
  for (const it of improvements(fixture(), { ready: false })) {
    assert.equal(it.level, "pending");
    assert.equal(it.title, "Pendiente");
    assert.equal(it.points, null);
  }
  const noBreakdown = improvements({ terms: [], sections: [], paa: [], schema: [], competitors: [], mine: { editorial: 0 }, targetWords: 0 });
  assert.ok(noBreakdown.every((x) => x.level === "pending" && x.title === "Sin datos" && x.points === null));
  const r = fixture();
  delete (r as any).terms;
  assert.equal(improvements(r).find((x) => x.area === "Contenido")!.level, "pending");
});

test("schema usa el mismo umbral que el score (≥30% de los competidores)", () => {
  const r = fixture();
  r.schema = [{ type: "FAQPage", count: 2, mine: false }]; // 2 de 10 < 30%: no cuenta
  const it = improvements(r).find((x) => x.area === "Schema")!;
  assert.equal(it.title, "Sin schema en común");
  assert.equal(it.level, "good");
});

test("color único por estado", () => {
  assert.equal(new Set(Object.values(LEVEL_DOT)).size, 4);
});
