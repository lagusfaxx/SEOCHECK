import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Response as UResponse } from "undici";
import { assertUrlAllowed, isBlockedIp, makeSafeAgent, safeFetch, SsrfError } from "./net/ssrf";

const blockedUrls = [
  "http://db:5432",
  "http://web:3000/api",
  "http://embeddings/embed",
  "http://browser:3000",
  "http://worker",
  "http://localhost:3000",
  "http://127.0.0.1",
  "http://127.1.2.3:8080/x",
  "http://2130706433/", // 127.0.0.1 en decimal
  "http://0x7f000001/",
  "http://169.254.169.254/latest/meta-data/",
  "http://10.0.0.8/",
  "http://172.16.5.4/",
  "http://172.31.255.255/",
  "http://192.168.1.1/",
  "http://0.0.0.0/",
  "http://[::1]/",
  "http://[::]/",
  "http://[fc00::1]/",
  "http://[fd12:3456::1]/",
  "http://[fe80::1]/",
  "http://[::ffff:10.0.0.1]/",
  "http://[::ffff:169.254.169.254]/",
  "file:///etc/passwd",
  "gopher://example.com/",
  "ftp://example.com/",
  "http://user:pass@example.com/",
];

test("URLs internas, privadas y protocolos no http quedan bloqueados", () => {
  for (const u of blockedUrls) assert.throws(() => assertUrlAllowed(u), SsrfError, u);
});

test("URLs públicas pasan la validación estática", () => {
  for (const u of ["https://example.com/", "http://93.184.216.34/", "https://[2606:4700:10::6814:179a]/", "http://172.32.0.1/", "http://11.0.0.1/"]) assert.doesNotThrow(() => assertUrlAllowed(u), u);
});

test("isBlockedIp", () => {
  assert.equal(isBlockedIp("169.254.169.254"), true);
  assert.equal(isBlockedIp("100.64.1.1"), true);
  assert.equal(isBlockedIp("8.8.8.8"), false);
  assert.equal(isBlockedIp("64:ff9b::a00:1"), true); // NAT64 → 10.0.0.1
  assert.equal(isBlockedIp("2001:4860:4860::8888"), false);
});

/** Servidor local: si alguna conexión llega aquí, la protección falló. */
async function trapServer() {
  let hits = 0;
  const srv = http.createServer((_, res) => { hits++; res.end("secreto"); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as { port: number }).port;
  return { port, hits: () => hits, close: () => new Promise((r) => srv.close(r)) };
}

test("dominio que resuelve a 10.x se bloquea en la conexión", async () => {
  const agent = makeSafeAgent(async () => [{ address: "10.1.2.3", family: 4 }]);
  await assert.rejects(safeFetch("http://intranet.example.com/", { agent }), SsrfError);
});

test("DNS rebinding: la IP validada es la que se usa para conectar", async () => {
  const trap = await trapServer();
  // El hostname pasa la validación estática, pero resuelve a loopback al conectar.
  const agent = makeSafeAgent(async () => [{ address: "127.0.0.1", family: 4 }]);
  await assert.rejects(safeFetch(`http://rebind.example.com:${trap.port}/`, { agent }), SsrfError);
  // Respuesta mixta pública + privada también se rechaza.
  const mixed = makeSafeAgent(async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]);
  await assert.rejects(safeFetch(`http://mixed.example.com:${trap.port}/`, { agent: mixed }), SsrfError);
  assert.equal(trap.hits(), 0);
  await trap.close();
});

test("redirect hacia IP privada o servicio interno se bloquea antes de seguirlo", async () => {
  for (const target of ["http://10.0.0.5/admin", "http://169.254.169.254/latest/meta-data/", "http://db:5432/", "http://[::1]/"]) {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new UResponse(null, { status: 302, headers: { location: target } });
    }) as any;
    await assert.rejects(safeFetch("https://public.example.com/", { fetchImpl }), SsrfError, target);
    assert.equal(calls, 1, target);
  }
});

test("redirect relativo a otro path público se sigue", async () => {
  const seen: string[] = [];
  const fetchImpl = (async (u: string) => {
    seen.push(u);
    return seen.length === 1 ? new UResponse(null, { status: 301, headers: { location: "/b" } }) : new UResponse("ok", { status: 200 });
  }) as any;
  const r = await safeFetch("https://public.example.com/a", { fetchImpl });
  assert.equal(r.finalUrl, "https://public.example.com/b");
  assert.deepEqual(r.redirects, [{ url: "https://public.example.com/a", status: 301 }]);
});
