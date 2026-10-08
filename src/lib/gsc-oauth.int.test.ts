/**
 * OAuth de Search Console: cifrado del token, state atado al usuario, y que la cuenta de servicio compartida
 * solo la use el workspace del dueño de la instancia. Requiere DATABASE_URL.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
let trustedP = "", clientP = "", wsIds: string[] = [];

before(async () => {
  process.env.TOKEN_ENC_KEY = randomBytes(32).toString("base64");
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client.apps.googleusercontent.com";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secreto";
  if (!hasDb) return;
  const { db } = await import("./db");
  const w1 = await db.workspace.create({ data: { name: "dueño", trusted: true } });
  const w2 = await db.workspace.create({ data: { name: "cliente" } });
  wsIds = [w1.id, w2.id];
  trustedP = (await db.project.create({ data: { workspaceId: w1.id, name: "a", domain: "a.cl" } })).id;
  clientP = (await db.project.create({ data: { workspaceId: w2.id, name: "b", domain: "b.cl" } })).id;
});

after(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  await db.workspace.deleteMany({ where: { id: { in: wsIds } } });
  await db.$disconnect();
});

test("el refresh token se guarda cifrado (AES-256-GCM) y no se puede alterar", async () => {
  const { encrypt, decrypt } = await import("./gsc-oauth");
  const blob = encrypt("1//refresh-token-secreto");
  assert.ok(!blob.includes("refresh-token-secreto"));
  assert.equal(decrypt(blob), "1//refresh-token-secreto");
  const [v, iv, tag, data] = blob.split(".");
  const tampered = [v, iv, tag, Buffer.from("x" + Buffer.from(data, "base64").toString("binary")).toString("base64")].join(".");
  assert.throws(() => decrypt(tampered));
  const prev = process.env.TOKEN_ENC_KEY;
  process.env.TOKEN_ENC_KEY = "corta";
  assert.throws(() => encrypt("x"), /32 bytes/);
  process.env.TOKEN_ENC_KEY = prev;
});

test("la cuenta de servicio compartida solo sirve al workspace del dueño; un cliente necesita su OAuth", { skip: !hasDb }, async () => {
  process.env.GSC_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "sa@x.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----\n" });
  const { env } = await import("./env");
  (env as any).gscCredentials = process.env.GSC_SERVICE_ACCOUNT_JSON;
  const { gscAvailable, gscClient } = await import("./providers/google");
  const { GscNotConnected } = await import("./gsc-oauth");
  assert.equal(await gscAvailable(trustedP), "sa");
  assert.equal(await gscAvailable(clientP), null);
  await assert.rejects(() => gscClient(clientP), GscNotConnected);
  // con su propia conexión OAuth, el cliente sí
  const { db } = await import("./db");
  const { encrypt } = await import("./gsc-oauth");
  await db.gscConnection.create({ data: { projectId: clientP, refreshTokenEnc: encrypt("1//tok"), scope: "https://www.googleapis.com/auth/webmasters.readonly", googleEmail: "cliente@gmail.com" } });
  assert.equal(await gscAvailable(clientP), "oauth");
  const c = await gscClient(clientP);
  assert.deepEqual(c.who, { kind: "oauth", email: "cliente@gmail.com" });
});

test("flujo OAuth: state de un solo uso, que vence y atado al usuario que lo empezó", { skip: !hasDb }, async () => {
  const { startUrl, finish } = await import("./gsc-oauth");
  const u = new URL(await startUrl(clientP, "user-1", "https://seo.test"));
  assert.equal(u.hostname, "accounts.google.com");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("redirect_uri"), "https://seo.test/api/oauth/google/callback");
  assert.match(u.searchParams.get("scope")!, /webmasters\.readonly/);
  const state = u.searchParams.get("state")!;
  // otro usuario no puede completar el flujo (y el state queda gastado)
  await assert.rejects(() => finish(state, "code", "user-2", "https://seo.test"), /otro usuario/);
  await assert.rejects(() => finish(state, "code", "user-1", "https://seo.test"), /venció o no es válida/);
  await assert.rejects(() => finish("inventado", "code", "user-1", "https://seo.test"), /venció o no es válida/);
});
