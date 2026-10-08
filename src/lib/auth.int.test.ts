/**
 * Autenticación, permisos y aislamiento entre clientes, llamando a las rutas reales de la API.
 * Requiere DATABASE_URL de PRUEBA (borra los usuarios).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const hasDb = Boolean(process.env.DATABASE_URL);
const B = "http://seocheck.test";
let auth: any, p: any, projects: any, members: any;
let projA = "", projB = "", crawlB = "", contentB = "";

const cookieOf = (r: Response) => (r.headers.get("set-cookie") ?? "").split(";")[0];
const call = (handler: any, path: string, init: RequestInit & { cookie?: string } = {}, params: any = {}) =>
  handler(new Request(`${B}${path}`, { ...init, headers: { "content-type": "application/json", ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.headers ?? {}) } }), { params });
const authCall = (action: string, body?: unknown, cookie?: string) =>
  call(body === undefined ? auth.GET : auth.POST, `/api/auth/${action}`, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), cookie }, { action });
const projCall = (method: "GET" | "POST" | "PATCH" | "DELETE", id: string, path: string, cookie: string, body?: unknown) => {
  const [pth, qs] = path.split("?");
  return call(p[method], `/api/p/${id}/${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), cookie }, { id, path: pth ? pth.split("/") : ["_"] }).then(async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null), qs }));
};

before(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  await db.user.deleteMany({});
  await db.rateLimit.deleteMany({});
  auth = await import("../app/api/auth/[action]/route");
  p = await import("../app/api/p/[id]/[...path]/route");
  projects = await import("../app/api/projects/route");
  members = await import("../app/api/workspace/members/route");
});

after(async () => {
  if (!hasDb) return;
  const { db } = await import("./db");
  await db.project.deleteMany({ where: { id: { in: [projA, projB].filter(Boolean) } } });
  await db.user.deleteMany({});
  await db.$disconnect();
});

test("primer usuario (dueño), login, rate limit y sesión", { skip: !hasDb }, async () => {
  // sin usuarios: /me pide setup
  assert.deepEqual(await (await authCall("me")).json(), { user: null, setup: true });
  assert.equal((await authCall("setup", { email: "dueno@agencia.cl", password: "corta" })).status, 400);
  const s = await authCall("setup", { email: "Dueno@Agencia.cl", password: "una-clave-larga-1" });
  assert.equal(s.status, 200);
  assert.match(s.headers.get("set-cookie")!, /sc_session=.+; Path=\/; HttpOnly; SameSite=Lax/);
  // un segundo setup ya no se puede
  assert.equal((await authCall("setup", { email: "otro@x.cl", password: "una-clave-larga-2" })).status, 409);

  // login: mismo mensaje para email inexistente y contraseña mala (no revela cuentas)
  const bad1 = await authCall("login", { email: "dueno@agencia.cl", password: "mala-clave-123" });
  const bad2 = await authCall("login", { email: "nadie@agencia.cl", password: "mala-clave-123" });
  assert.equal(bad1.status, 401);
  assert.deepEqual(await bad1.json(), await bad2.json());
  const ok = await authCall("login", { email: "dueno@agencia.cl", password: "una-clave-larga-1" });
  assert.equal(ok.status, 200);
  const me = await (await authCall("me", undefined, cookieOf(ok))).json();
  assert.equal(me.user.email, "dueno@agencia.cl");
  assert.equal(me.workspaces[0].role, "owner");
  assert.equal(me.workspaces[0].trusted, true);

  // fuerza bruta: a los 8 fallos seguidos la cuenta se frena (también en paralelo)
  const tries = await Promise.all(Array.from({ length: 10 }, () => authCall("login", { email: "victima@x.cl", password: "x".repeat(12) })));
  assert.equal(tries.filter((r) => r.status === 429).length, 2);
  // token inventado o cookie ausente: sin acceso
  assert.equal((await (await authCall("me", undefined, "sc_session=inventado")).json()).user, null);
});

test("aislamiento: un cliente no ve ni toca nada del otro", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  const owner = cookieOf(await authCall("login", { email: "dueno@agencia.cl", password: "una-clave-larga-1" }));
  // cliente B: otro usuario con su propio workspace (invitado por nadie: alta directa con registro abierto)
  process.env.SIGNUP_ENABLED = "true";
  const sB = await authCall("signup", { email: "cliente-b@otra.cl", password: "clave-de-b-larga" });
  assert.equal(sB.status, 200);
  delete process.env.SIGNUP_ENABLED;
  assert.equal((await authCall("signup", { email: "c@x.cl", password: "clave-larga-c" })).status, 403); // registro cerrado por defecto
  const userB = cookieOf(sB);

  const mk = async (cookie: string, domain: string) => (await (await call(projects.POST, "/api/projects", { method: "POST", body: JSON.stringify({ domain }), cookie })).json()).id;
  projA = await mk(owner, "cliente-a.cl");
  projB = await mk(userB, "cliente-b.cl");
  crawlB = (await db.crawl.create({ data: { projectId: projB, status: "completed" } })).id;
  contentB = (await db.contentAnalysis.create({ data: { projectId: projB, url: "https://cliente-b.cl/", keyword: "secreto", status: "done" } })).id;

  // listado de proyectos: cada uno ve solo los suyos
  const listB = await (await call(projects.GET, "/api/projects", { cookie: userB })).json();
  assert.deepEqual(listB.map((x: any) => x.domain), ["cliente-b.cl"]);

  // A no puede leer el proyecto de B (404, no 403: no revela que existe)
  for (const path of ["_", "audit", "report", "jobs", "costs", "content", "gsc", "rank"]) assert.equal((await projCall("GET", projB, path, owner)).status, 404, path);
  assert.equal((await projCall("DELETE", projB, "_", owner)).status, 404);
  // ni colando ids de B dentro de SU proyecto
  const crossCrawl = await call(p.GET, `/api/p/${projA}/audit?crawl=${crawlB}`, { cookie: owner }, { id: projA, path: ["audit"] });
  assert.equal(crossCrawl.status, 404);
  const crossContent = await call(p.GET, `/api/p/${projA}/content/one?cid=${contentB}`, { cookie: owner }, { id: projA, path: ["content", "one"] });
  assert.equal(crossContent.status, 404);
  // ni mandando a crawlear/analizar el dominio de otro
  assert.equal((await projCall("POST", projA, "audit", owner, { startUrl: "https://cliente-b.cl/" })).status, 400);
  assert.equal((await projCall("POST", projA, "content", owner, { url: "https://cliente-b.cl/x", keyword: "k" })).status, 400);
  // sin sesión: 401
  assert.equal((await projCall("GET", projA, "_", "")).status, 401);
  // su propio proyecto sí
  assert.equal((await projCall("GET", projA, "_", owner)).status, 200);
});

test("recuperación de contraseña, cambio de contraseña e invitaciones", { skip: !hasDb }, async () => {
  const { db } = await import("./db");
  const { createReset } = await import("./auth");
  const owner = cookieOf(await authCall("login", { email: "dueno@agencia.cl", password: "una-clave-larga-1" }));
  // forgot: misma respuesta exista o no la cuenta
  const f1 = await (await authCall("forgot", { email: "dueno@agencia.cl" })).json();
  const f2 = await (await authCall("forgot", { email: "no@existe.cl" })).json();
  assert.deepEqual(f1, f2);
  // reset: cambia la clave, cierra las otras sesiones y el token no se puede reusar
  const u = await db.user.findUniqueOrThrow({ where: { email: "dueno@agencia.cl" } });
  const token = await createReset(u.id);
  const r = await authCall("reset", { token, password: "clave-nueva-larga-9" });
  assert.equal(r.status, 200);
  assert.equal((await (await authCall("me", undefined, owner)).json()).user, null); // la sesión vieja murió
  assert.equal((await authCall("reset", { token, password: "otra-clave-larga-0" })).status, 400);
  const owner2 = cookieOf(await authCall("login", { email: "dueno@agencia.cl", password: "clave-nueva-larga-9" }));

  // invitar: crea la cuenta y, sin correo configurado, devuelve el link a quien invita
  const ws = (await (await authCall("me", undefined, owner2)).json()).workspaces[0].id;
  const inv = await call(members.POST, `/api/workspace/members?workspace=${ws}`, { method: "POST", body: JSON.stringify({ email: "socio@agencia.cl", role: "member" }), cookie: owner2 });
  const ij = await inv.json();
  assert.equal(inv.status, 200);
  assert.match(ij.link, /\/reset\?token=.+&invite=1$/);
  const inviteToken = new URL(ij.link).searchParams.get("token")!;
  const acc = await authCall("reset", { token: inviteToken, password: "clave-del-socio-1" });
  const socio = cookieOf(acc);
  // el miembro ve el proyecto del workspace, pero no puede borrarlo ni invitar
  assert.equal((await projCall("GET", projA, "_", socio)).status, 200);
  assert.equal((await projCall("DELETE", projA, "_", socio)).status, 403);
  const inv2 = await call(members.POST, `/api/workspace/members?workspace=${ws}`, { method: "POST", body: JSON.stringify({ email: "x@y.cl" }), cookie: socio });
  assert.equal(inv2.status, 403);
  // no se puede quitar al único dueño
  const del = await call(members.DELETE, `/api/workspace/members?workspace=${ws}`, { method: "DELETE", body: JSON.stringify({ userId: u.id }), cookie: owner2 });
  assert.equal(del.status, 400);
  // cambio de contraseña con la actual equivocada
  assert.equal((await authCall("password", { current: "mala-mala-mala", password: "otra-clave-larga-2" }, socio)).status, 401);
});
