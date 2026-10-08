import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

const req = (path: string, headers: Record<string, string> = {}) => new NextRequest(new URL(path, "http://seocheck.test"), { headers });

test("healthcheck abierto aunque haya BASIC_AUTH (si no, Coolify marca unhealthy y Traefik da 404)", () => {
  process.env.BASIC_AUTH = "admin:clave";
  try {
    assert.equal(middleware(req("/api/health")).status, 200);
    // el resto sigue protegido
    assert.equal(middleware(req("/login")).status, 401);
    const ok = middleware(req("/login", { authorization: `Basic ${btoa("admin:clave")}` }));
    assert.equal(ok.status, 200);
  } finally {
    delete process.env.BASIC_AUTH;
  }
});

test("sin sesión: páginas redirigen a /login y la API responde 401", () => {
  assert.equal(middleware(req("/api/health")).status, 200);
  const page = middleware(req("/p/abc/audit"));
  assert.equal(page.status, 307);
  assert.match(page.headers.get("location")!, /\/login\?next=%2Fp%2Fabc%2Faudit$/);
  assert.equal(middleware(req("/api/projects")).status, 401);
  assert.equal(middleware(req("/p/abc", { cookie: "sc_session=x" })).status, 200);
});
