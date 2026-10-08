import { db } from "@/lib/db";
import {
  AuthError, clearCookie, clearRateLimit, clientIp, consumeReset, createReset, createSession, dummyHash, hashPassword, isSecure, normEmail,
  passwordProblem, rateLimit, readCookie, requireUser, SESSION_COOKIE, sessionCookie, tokenHash, userFromRequest, validEmail, verifyPassword,
} from "@/lib/auth";
import { sendMail } from "@/lib/mail";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, { status, headers });
const fail = (msg: string, status = 400, headers: Record<string, string> = {}) => json({ error: msg }, status, headers);

async function limited(key: string, max: number, windowMs: number) {
  const r = await rateLimit(key, max, windowMs);
  if (!r.ok) throw Object.assign(new AuthError(429, `Demasiados intentos. Prueba de nuevo en ${Math.ceil(r.retryAfter / 60)} min.`), { retryAfter: r.retryAfter });
}

const appUrl = (req: Request) => (process.env.APP_URL ?? new URL(req.url).origin).replace(/\/$/, "");

const handlers: Record<string, (req: Request) => Promise<Response>> = {
  /** POST {email, password} */
  async login(req) {
    const b = await req.json().catch(() => ({}));
    const email = normEmail(b.email);
    const ip = clientIp(req);
    // por IP y por cuenta: frena tanto el barrido de contraseñas como el de cuentas
    await limited(`login:ip:${ip}`, 20, 15 * 60_000);
    await limited(`login:email:${email}`, 8, 15 * 60_000);
    const user = email ? await db.user.findUnique({ where: { email } }) : null;
    const okPw = await verifyPassword(String(b.password ?? ""), user?.passwordHash ?? (await dummyHash()));
    if (!user || !okPw) return fail("Email o contraseña incorrectos", 401);
    await clearRateLimit(`login:email:${email}`);
    const { token, expiresAt } = await createSession(user.id, { ip, userAgent: req.headers.get("user-agent") });
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, expiresAt, isSecure(req)) });
  },

  async logout(req) {
    const t = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
    if (t) await db.session.deleteMany({ where: { id: tokenHash(t) } });
    return json({ ok: true }, 200, { "set-cookie": clearCookie(isSecure(req)) });
  },

  /** GET: usuario y workspaces (con rol) */
  async me(req) {
    const u = await userFromRequest(req);
    if (!u) return json({ user: null, setup: (await db.user.count()) === 0 }, 200);
    const ms = await db.membership.findMany({ where: { userId: u.id }, include: { workspace: { select: { id: true, name: true, trusted: true } } } });
    return json({ user: u, workspaces: ms.map((m) => ({ ...m.workspace, role: m.role })) });
  },

  /**
   * POST {email, password, name?}: crea el primer usuario (dueño) cuando la instancia no tiene ninguno.
   * Los workspaces que ya existían (instalaciones anteriores) pasan a ser suyos y quedan como "trusted".
   */
  async setup(req) {
    await limited(`setup:${clientIp(req)}`, 10, 60 * 60_000);
    const b = await req.json().catch(() => ({}));
    const email = normEmail(b.email);
    if (!validEmail(email)) return fail("Email inválido");
    const pwErr = passwordProblem(b.password);
    if (pwErr) return fail(pwErr);
    const passwordHash = await hashPassword(b.password);
    const user = await db.$transaction(async (tx) => {
      // serializa: dos setups simultáneos no pueden crear dos dueños
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4242001)`;
      if ((await tx.user.count()) > 0) throw new AuthError(409, "La instancia ya tiene usuarios: inicia sesión");
      const u = await tx.user.create({ data: { email, name: typeof b.name === "string" ? b.name.slice(0, 100) : null, passwordHash } });
      let wss = await tx.workspace.findMany({ select: { id: true } });
      if (!wss.length) wss = [await tx.workspace.create({ data: { name: "Mi agencia" }, select: { id: true } })];
      await tx.workspace.updateMany({ data: { trusted: true } });
      await tx.membership.createMany({ data: wss.map((w) => ({ userId: u.id, workspaceId: w.id, role: "owner" })) });
      return u;
    });
    const { token, expiresAt } = await createSession(user.id, { ip: clientIp(req), userAgent: req.headers.get("user-agent") });
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, expiresAt, isSecure(req)) });
  },

  /** POST {email, password, name?}: registro abierto solo si SIGNUP_ENABLED=true (cada uno con su workspace) */
  async signup(req) {
    if (process.env.SIGNUP_ENABLED !== "true") return fail("El registro está cerrado: pide una invitación", 403);
    await limited(`signup:${clientIp(req)}`, 5, 60 * 60_000);
    const b = await req.json().catch(() => ({}));
    const email = normEmail(b.email);
    if (!validEmail(email)) return fail("Email inválido");
    const pwErr = passwordProblem(b.password);
    if (pwErr) return fail(pwErr);
    if (await db.user.findUnique({ where: { email } })) return fail("Ese email ya tiene cuenta: inicia sesión o recupera la contraseña", 409);
    const u = await db.user.create({
      data: {
        email,
        name: typeof b.name === "string" ? b.name.slice(0, 100) : null,
        passwordHash: await hashPassword(b.password),
        memberships: { create: { role: "owner", workspace: { create: { name: typeof b.company === "string" && b.company ? b.company.slice(0, 100) : email.split("@")[0] } } } },
      },
    });
    const { token, expiresAt } = await createSession(u.id, { ip: clientIp(req), userAgent: req.headers.get("user-agent") });
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, expiresAt, isSecure(req)) });
  },

  /** POST {email}: manda el link de recuperación. Responde igual exista o no la cuenta. */
  async forgot(req) {
    const b = await req.json().catch(() => ({}));
    const email = normEmail(b.email);
    await limited(`forgot:ip:${clientIp(req)}`, 10, 60 * 60_000);
    await limited(`forgot:email:${email}`, 3, 60 * 60_000);
    const user = validEmail(email) ? await db.user.findUnique({ where: { email } }) : null;
    if (user) {
      const token = await createReset(user.id);
      const link = `${appUrl(req)}/reset?token=${token}`;
      await sendMail(email, "Recupera tu contraseña de SEOCHECK", `Para elegir una contraseña nueva abre este link (vence en 1 hora):\n\n${link}\n\nSi no lo pediste, ignora este correo.`, link);
    }
    return json({ ok: true, message: "Si el email tiene cuenta, te llegará un link para recuperar la contraseña." });
  },

  /** POST {token, password} */
  async reset(req) {
    await limited(`reset:${clientIp(req)}`, 20, 60 * 60_000);
    const b = await req.json().catch(() => ({}));
    const pwErr = passwordProblem(b.password);
    if (pwErr) return fail(pwErr);
    const userId = await consumeReset(String(b.token ?? ""), b.password);
    const { token, expiresAt } = await createSession(userId, { ip: clientIp(req), userAgent: req.headers.get("user-agent") });
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, expiresAt, isSecure(req)) });
  },

  /** POST {current, password}: cambiar la contraseña estando logueado (cierra las otras sesiones) */
  async password(req) {
    const u = await requireUser(req);
    await limited(`password:${u.id}`, 10, 60 * 60_000);
    const b = await req.json().catch(() => ({}));
    const pwErr = passwordProblem(b.password);
    if (pwErr) return fail(pwErr);
    const full = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    if (!(await verifyPassword(String(b.current ?? ""), full.passwordHash))) return fail("La contraseña actual no es correcta", 401);
    const keep = tokenHash(readCookie(req.headers.get("cookie")) ?? "");
    await db.$transaction([
      db.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(b.password) } }),
      db.session.deleteMany({ where: { userId: u.id, id: { not: keep } } }),
    ]);
    return json({ ok: true });
  },
};

async function handle(req: Request, { params }: { params: { action: string } }) {
  const h = handlers[params.action];
  if (!h) return fail("not found", 404);
  const method = params.action === "me" ? "GET" : "POST";
  if (req.method !== method) return fail("método no permitido", 405);
  try {
    return await h(req);
  } catch (e) {
    if (e instanceof AuthError) return fail(e.message, e.status, (e as { retryAfter?: number }).retryAfter ? { "retry-after": String((e as { retryAfter?: number }).retryAfter) } : {});
    console.error(`[auth] ${params.action}`, e);
    return fail("Error interno", 500);
  }
}

export const GET = handle;
export const POST = handle;
