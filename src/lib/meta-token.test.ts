import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenCall } from "./providers/meta";

const realFetch = globalThis.fetch;
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("canje de token: si Instagram rechaza GET, prueba POST", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${String(url).split("?")[0]}`);
    if ((init?.method ?? "GET") === "GET") return reply(400, { error: { message: "Unsupported request - method type: get" } });
    return reply(200, { access_token: "largo", expires_in: 5184000 });
  }) as typeof fetch;
  try {
    const r = await tokenCall("access_token", { grant_type: "ig_exchange_token", client_secret: "s", access_token: "corto" });
    assert.ok(r.ok);
    assert.equal(r.ok && r.data.access_token, "largo");
    assert.deepEqual(calls, ["GET https://graph.instagram.com/v21.0/access_token", "POST https://graph.instagram.com/access_token"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("canje de token: si todo falla devuelve el primer error sin lanzar", async () => {
  globalThis.fetch = (async () => reply(400, { error: { message: "Unsupported request - method type: get" } })) as unknown as typeof fetch;
  const err = console.error;
  console.error = () => {};
  try {
    const r = await tokenCall("access_token", { grant_type: "ig_exchange_token", client_secret: "s", access_token: "corto" });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.error, "Unsupported request - method type: get");
  } finally {
    globalThis.fetch = realFetch;
    console.error = err;
  }
});
