import { test } from "node:test";
import assert from "node:assert/strict";
import { canSubmit, initialTarget, keywordChanged, lowRelevanceWarning, targetReducer, type TargetAction, type TargetState } from "./content/target-state";

const BALANCIN = "https://sintornillo.cl/products/balancin-pikler-waldorf-montessori";
const TORRE = "https://sintornillo.cl/products/torre-de-aprendizaje-montessori";
const run = (...as: TargetAction[]) => as.reduce(targetReducer, initialTarget as TargetState);

test("keywordChanged: cambios menores no cuentan, otra búsqueda sí", () => {
  assert.equal(keywordChanged("balancin montessori", "balancines montessori"), false);
  assert.equal(keywordChanged("balancin montessori", "Balancín Montessori"), false);
  assert.equal(keywordChanged("balancin montessori", "torre montessori"), true);
});

test("1. sugerencia + cambio de keyword → limpia la URL", () => {
  const s = run({ type: "keyword", keyword: "balancin montessori" }, { type: "pickSuggestion", url: BALANCIN }, { type: "keyword", keyword: "torre montessori" });
  assert.equal(s.url, "");
  assert.equal(s.source, null);
  assert.equal(s.cleared, true);
  // corregir un plural no limpia la sugerencia
  const t = run({ type: "keyword", keyword: "balancin montessori" }, { type: "pickSuggestion", url: BALANCIN }, { type: "keyword", keyword: "balancines montessori" });
  assert.equal(t.url, BALANCIN);
});

test("2. manual + cambio de keyword → conserva la URL", () => {
  const s = run({ type: "keyword", keyword: "balancin montessori" }, { type: "typeUrl", url: BALANCIN }, { type: "keyword", keyword: "torre montessori" });
  assert.equal(s.url, BALANCIN);
  assert.equal(s.source, "manual");
});

test("3. manual poco relevante → advertencia; «Mantener esta URL» la oculta para esa keyword", () => {
  let s = run({ type: "keyword", keyword: "balancin montessori" }, { type: "typeUrl", url: BALANCIN });
  assert.equal(lowRelevanceWarning(s), false);
  s = targetReducer(s, { type: "keyword", keyword: "torre de aprendizaje" });
  assert.equal(lowRelevanceWarning(s), true);
  assert.equal(canSubmit(s).ok, false);
  s = targetReducer(s, { type: "keepManual" });
  assert.equal(lowRelevanceWarning(s), false);
  assert.equal(canSubmit(s).ok, true);
  // si la keyword vuelve a cambiar de verdad, se evalúa de nuevo
  s = targetReducer(s, { type: "keyword", keyword: "cama casita" });
  assert.equal(lowRelevanceWarning(s), true);
  // una URL manual que está entre las sugerencias de la keyword no advierte
  assert.equal(lowRelevanceWarning(s, [BALANCIN]), false);
});

test("4. elegir una nueva sugerencia → desaparece la advertencia", () => {
  let s = run({ type: "keyword", keyword: "balancin montessori" }, { type: "typeUrl", url: BALANCIN }, { type: "keyword", keyword: "torre montessori" });
  assert.equal(lowRelevanceWarning(s), true);
  s = targetReducer(s, { type: "pickSuggestion", url: TORRE });
  assert.equal(lowRelevanceWarning(s), false);
  assert.equal(s.source, "suggestion");
  assert.equal(canSubmit(s).ok, true);
});

test("5. nunca se envía en silencio una URL sugerida para otra keyword", () => {
  // por el reducer: la URL se limpia al cambiar la keyword
  const s = run({ type: "keyword", keyword: "balancin montessori" }, { type: "pickSuggestion", url: BALANCIN }, { type: "keyword", keyword: "torre montessori" });
  assert.deepEqual(canSubmit(s), { ok: false, reason: "Elige de nuevo la página para esta keyword" });
  // y aunque un estado llegue armado a mano con la URL vieja, canSubmit lo rechaza
  const stale: TargetState = { ...initialTarget, keyword: "torre montessori", url: BALANCIN, source: "suggestion", forKeyword: "balancin montessori" };
  assert.equal(canSubmit(stale).ok, false);
  // en cualquier secuencia de acciones, una sugerencia enviable siempre corresponde a la keyword actual
  const kws = ["balancin montessori", "torre montessori", "balancines montessori", "cama casita", ""];
  const acts: TargetAction[] = [...kws.map((keyword) => ({ type: "keyword", keyword }) as TargetAction), { type: "pickSuggestion", url: BALANCIN }, { type: "pickSuggestion", url: TORRE }, { type: "typeUrl", url: TORRE }, { type: "keepManual" }];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = 0; i < 2000; i++) {
    let st: TargetState = initialTarget;
    for (let j = 0; j < 8; j++) {
      st = targetReducer(st, acts[Math.floor(rnd() * acts.length)]);
      if (canSubmit(st).ok && st.source === "suggestion") assert.equal(keywordChanged(st.forKeyword, st.keyword), false, JSON.stringify(st));
    }
  }
});
