import { test } from "node:test";
import assert from "node:assert/strict";
import { brandOf, isHomeUrl, isSpecific, kwTokens, scorePage } from "./content/suggest";

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

test("brandOf / isSpecific", () => {
  assert.deepEqual(brandOf("sin-tornillo.cl"), ["sin", "tornillo", "sintornillo"]);
  assert.equal(isSpecific(kwTokens("balancin montessori"), brandOf("sintornillo.cl")), true);
  assert.equal(isSpecific(kwTokens("sintornillo"), brandOf("sintornillo.cl")), false);
  assert.equal(isSpecific(kwTokens("sintornillo muebles"), brandOf("sintornillo.cl")), false);
});

test("scorePage: la home no se excluye; gana cuando la keyword es la marca", () => {
  const brand = brandOf("sintornillo.cl");
  const kw = kwTokens("sintornillo");
  const home = scorePage(kw, { url: "https://sintornillo.cl/", title: "Sintornillo | Muebles que se arman sin tornillos", h1: ["Sintornillo"] }, brand);
  const contacto = scorePage(kw, { url: "https://sintornillo.cl/contacto", title: "Contacto | Sintornillo", h1: ["Contacto"] }, brand);
  assert.ok(home > contacto, `${home} > ${contacto}`);
});
