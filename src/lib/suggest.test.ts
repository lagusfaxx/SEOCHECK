import { test } from "node:test";
import assert from "node:assert/strict";
import { isHomeUrl, kwTokens, scorePage } from "./content/suggest";

test("kwTokens: sin tildes, sin palabras vacías y singular aproximado", () => {
  assert.deepEqual(kwTokens("Balancín Montessori"), ["balancin", "montessori"]);
  assert.deepEqual(kwTokens("balancines para niños"), ["balancin", "nino"]);
});

test("isHomeUrl", () => {
  assert.equal(isHomeUrl("https://sintornillo.cl/"), true);
  assert.equal(isHomeUrl("https://sintornillo.cl"), true);
  assert.equal(isHomeUrl("https://sintornillo.cl/producto/balancin"), false);
});

test("scorePage: la ficha que calza en la ruta gana a la home que solo lo menciona en el title", () => {
  const kw = kwTokens("balancin montessori");
  const ficha = scorePage(kw, { url: "https://sintornillo.cl/producto/balancin-montessori", title: "Balancín Montessori | Sintornillo", h1: ["Balancín Montessori"] });
  const home = scorePage(kw, { url: "https://sintornillo.cl/", title: "Sintornillo | Balancín Montessori y muebles", h1: ["Muebles que se arman sin tornillos"] });
  const otra = scorePage(kw, { url: "https://sintornillo.cl/producto/torre", title: "Torre de aprendizaje | Sintornillo", h1: ["Torre"] });
  assert.ok(ficha > home, `${ficha} > ${home}`);
  assert.equal(otra, 0);
});

test("scorePage: calce parcial vale menos que calce completo", () => {
  const kw = kwTokens("balancin montessori");
  const completa = scorePage(kw, { url: "https://x.cl/balancin-montessori", title: null, h1: [] });
  const parcial = scorePage(kw, { url: "https://x.cl/montessori", title: null, h1: [] });
  assert.ok(completa > parcial && parcial > 0);
});
