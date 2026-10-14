import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeIgUsername } from "./ig-access";

test("usuario de Instagram: acepta @, link del perfil y mayúsculas", () => {
  assert.equal(normalizeIgUsername("@TaupOC.cl"), "taupoc.cl");
  assert.equal(normalizeIgUsername("  nomad_brew "), "nomad_brew");
  assert.equal(normalizeIgUsername("https://www.instagram.com/nomadbrew.cl/?hl=es"), "nomadbrew.cl");
  assert.equal(normalizeIgUsername("instagram.com/abc"), "abc");
});

test("usuario de Instagram: rechaza lo que no puede ser un usuario", () => {
  for (const v of ["", "@", "con espacio", "a".repeat(31), ".empieza", "termina.", "dos..puntos", "ñandú", 42, null]) assert.equal(normalizeIgUsername(v), null, String(v));
});
