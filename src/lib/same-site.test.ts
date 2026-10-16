import { test } from "node:test";
import assert from "node:assert/strict";
import { bareHost, sameSite } from "./util";
import { matchingProperties } from "./ga4";

test("propiedad del mismo dominio: sí; de otro dominio: nunca", () => {
  assert.equal(bareHost("https://www.Taupoc.cl/tienda?x=1"), "taupoc.cl");
  assert.equal(bareHost("sc-domain:taupoc.cl"), "taupoc.cl");
  assert.ok(sameSite("sc-domain:taupoc.cl", "taupoc.cl"));
  assert.ok(sameSite("https://www.taupoc.cl/", "taupoc.cl"));
  assert.ok(sameSite("sc-domain:taupoc.cl", "www.taupoc.cl"), "propiedad de dominio cubre al www");
  assert.ok(sameSite("https://tienda.taupoc.cl/", "taupoc.cl"), "subdominio del proyecto");
  assert.ok(!sameSite("sc-domain:tacos.cl", "taupoc.cl"));
  assert.ok(!sameSite("https://taupoc.cl.evil.com/", "taupoc.cl"));
  assert.ok(!sameSite("https://mitaupoc.cl/", "taupoc.cl"), "no basta con terminar igual");
  assert.ok(!sameSite("", "taupoc.cl"));
});

test("Analytics: solo las propiedades cuyo sitio web es el del proyecto", () => {
  const props = [
    { property: "properties/1", displayName: "Taupoc", account: "A", sites: ["taupoc.cl"] },
    { property: "properties/2", displayName: "Tacos", account: "A", sites: ["tacos.cl"] },
    { property: "properties/3", displayName: "Sin web", account: "A", sites: [] },
  ];
  assert.deepEqual(matchingProperties(props, "www.taupoc.cl").map((p) => p.property), ["properties/1"]);
});
