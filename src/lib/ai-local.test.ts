import { test } from "node:test";
import assert from "node:assert/strict";
import { findOwnPlace, parseAiRank, parsePlaces } from "./ai-local";

test("AI Ranking: un bloque por motor, venga como objeto o como lista", () => {
  const byKey = parseAiRank({ results: { chatgpt: { target_found: true, target_position: 2, citations: [{ domain: "www.rival.cl" }, { url: "https://mi.cl/x" }] }, gemini: { target_found: false, target_position: null, citations: [] } } });
  assert.deepEqual(byKey.map((r) => [r.engine, r.found, r.position]), [["chatgpt", true, 2], ["gemini", false, null]]);
  assert.deepEqual(byKey[0].cited, ["rival.cl", "mi.cl"]);
  const list = parseAiRank({ engines: [{ engine: "Claude", target_found: false, citations: [] }] });
  assert.equal(list[0].engine, "claude");
});

test("Maps: lugares y el negocio propio por sitio web o nombre", () => {
  const places = parsePlaces({ places: [{ rank: 1, name: "Natación Pro", website: "https://pro.cl", rating: 4.8 }, { rank: 2, name: "Taupoc Chile", website: null, rating: 4.9 }, { rank: 3, name: "Otra", website: "https://www.mi-tienda.cl/contacto", rating: 4 }] });
  assert.equal(findOwnPlace(places, "mi-tienda.cl")?.rank, 3);
  assert.equal(findOwnPlace(places, "taupoc.cl", "TAUPOC Chile")?.rank, 2);
  assert.equal(findOwnPlace(places, "nada.cl"), null);
});
