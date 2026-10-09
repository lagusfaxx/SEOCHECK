import { test } from "node:test";
import assert from "node:assert/strict";
import { implementationMarkdown } from "./content/brief-tools";

test("instrucciones de implementación: neutrales respecto del asistente de programación", () => {
  const md = implementationMarkdown({
    url: "https://sintornillo.cl/products/balancin",
    keyword: "balancin montessori",
    brief: { titles: ["Balancín Montessori | Sintornillo"], metas: ["Descubre…"], outline: [{ id: "a", tag: "h2", text: "Qué es", state: "required" }], faq: [] },
  });
  assert.doesNotMatch(md, /claude|codex|copilot|gemini|cursor|anthropic|openai/i);
  assert.match(md, /asistente de programación/);
  // la funcionalidad se mantiene: title, meta, encabezados con estado y brief completo
  assert.match(md, /Title: Balancín Montessori \| Sintornillo/);
  assert.match(md, /## Qué es \[required\]/);
  assert.match(md, /```json/);
});
