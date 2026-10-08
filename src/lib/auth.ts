/**
 * Autenticación y permisos.
 *
 * - Contraseñas con scrypt (sal por usuario). Nunca se guardan ni se loguean en claro.
 * - Sesión = token aleatorio en cookie httpOnly; en la base va solo su hash (si se filtra la base, no sirven).
 * - Todo acceso a un proyecto pasa por la membresía del usuario en el workspace del proyecto.
 * - Rate limit atómico en Postgres (sirve con varias instancias de web).
 */
import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db } from "./db";

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

export const SESSION_COOKIE = "sc_session";
export const SESSION_DAYS = 30;
export const MIN_PASSWORD = 10;

export class AuthError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

// ---------- contraseñas ----------

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const key = await scrypt(pw, salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, N, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await scrypt(pw, Buffer.from(salt, "base64"), want.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Hash de relleno: si el email no existe igual se gasta el mismo tiempo (no revela qué emails existen). */
let dummy: Promise<string> | null = null;
export const dummyHash = () => (dummy ??= hashPassword(randomBytes(12).toString("hex")));

export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`;
  if (pw.length > 200) return "La contraseña es demasiado larga";
  return null;
}

export const normEmail = (e: unknown) => (typeof e === "string" ? e.trim().toLowerCase() : "");
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

// ---------- tokens y sesiones ----------

export const newToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.session.create({ data: { id: tokenHash(token), userId, expiresAt, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null } });
  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  return { token, expiresAt };
}

export function sessionCookie(token: string, expiresAt: Date, secure: boolean) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure ? "; Secure" : ""}`;
}
export const clearCookie = (secure: boolean) => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;

export function readCookie(header: string | null | undefined, name = SESSION_COOKIE): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export type AuthUser = { id: string; email: string; name: string | null };

/** Usuario de la sesión (o null). Renueva la sesión si se está por vencer. */
export async function userFromToken(token: string | null | undefined): Promise<AuthUser | null> {
  if (!token || token.length > 100) return null;
  const s = await db.session.findUnique({ where: { id: tokenHash(token) }, include: { user: { select: { id: true, email: true, name: true } } } });
  if (!s) return null;
  if (s.expiresAt < new Date()) {
    await db.session.delete({ where: { id: s.id } }).catch(() => {});
    return null;
  }
  // sesión deslizante: si se usa, dura 30 días más (se actualiza como mucho cada hora)
  if (Date.now() - s.lastSeenAt.getTime() > 3600_000)
    await db.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_DAYS * 864e5) } }).catch(() => {});
  return s.user;
}

export const userFromRequest = (req: Request) => userFromToken(readCookie(req.headers.get("cookie")));

export async function requireUser(req: Request): Promise<AuthUser> {
  const u = await userFromRequest(req);
  if (!u) throw new AuthError(401, "Inicia sesión");
  return u;
}

// ---------- permisos ----------

export type Role = "owner" | "admin" | "member";
const RANK: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

/** Rol del usuario en el workspace del proyecto, o null si no tiene acceso. */
export async function projectRole(userId: string, projectId: string): Promise<Role | null> {
  const m = await db.membership.findFirst({ where: { userId, workspace: { projects: { some: { id: projectId } } } }, select: { role: true } });
  return (m?.role as Role) ?? null;
}

/** Acceso al proyecto con al menos `min`. Sin acceso responde 404 (no revela que el proyecto existe). */
export async function requireProject(userId: string, projectId: string, min: Role = "member"): Promise<Role> {
  const role = await projectRole(userId, projectId);
  if (!role) throw new AuthError(404, "no existe");
  if (RANK[role] < RANK[min]) throw new AuthError(403, "Tu rol no permite esta acción");
  return role;
}

export async function workspaceRole(userId: string, workspaceId: string): Promise<Role | null> {
  const m = await db.membership.findUnique({ where: { userId_workspaceId: { userId, workspaceId } }, select: { role: true } });
  return (m?.role as Role) ?? null;
}

export async function requireWorkspace(userId: string, workspaceId: string, min: Role = "member"): Promise<Role> {
  const role = await workspaceRole(userId, workspaceId);
  if (!role) throw new AuthError(404, "no existe");
  if (RANK[role] < RANK[min]) throw new AuthError(403, "Tu rol no permite esta acción");
  return role;
}

export const userWorkspaceIds = async (userId: string) => (await db.membership.findMany({ where: { userId }, select: { workspaceId: true } })).map((m) => m.workspaceId);

// ---------- rate limit ----------

/**
 * Cuenta un intento para `key` en una ventana. Atómico (un solo upsert en Postgres): no se puede saltar con
 * requests en paralelo. Devuelve si quedó dentro del límite y cuántos segundos faltan para que se libere.
 */
export async function rateLimit(key: string, max: number, windowMs: number): Promise<{ ok: boolean; retryAfter: number }> {
  const rows = await db.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO "RateLimit" ("key", "count", "resetAt") VALUES (${key}, 1, now() + ${`${windowMs} milliseconds`}::interval)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."resetAt" < now() THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" < now() THEN now() + ${`${windowMs} milliseconds`}::interval ELSE "RateLimit"."resetAt" END
    RETURNING "count", "resetAt"`;
  const r = rows[0];
  return { ok: r.count <= max, retryAfter: Math.max(0, Math.ceil((new Date(r.resetAt).getTime() - Date.now()) / 1000)) };
}

/** Límite en memoria (por proceso) para el tráfico normal de la API: barato y suficiente contra abusos. */
const mem = new Map<string, { n: number; reset: number }>();
export function memLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const e = mem.get(key);
  if (!e || e.reset < now) {
    mem.set(key, { n: 1, reset: now + windowMs });
    if (mem.size > 10_000) for (const [k, v] of mem) if (v.reset < now) mem.delete(k);
    return true;
  }
  e.n++;
  return e.n <= max;
}

export async function clearRateLimit(key: string) {
  await db.rateLimit.delete({ where: { key } }).catch(() => {});
}

export function clientIp(req: Request): string {
  // detrás del proxy de Coolify (Traefik): el primer IP de X-Forwarded-For
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim().slice(0, 64);
}

export const isSecure = (req: Request) => new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";

// ---------- recuperación ----------

export async function createReset(userId: string, hours = 1) {
  const token = newToken();
  await db.passwordReset.create({ data: { id: tokenHash(token), userId, expiresAt: new Date(Date.now() + hours * 3600_000) } });
  return token;
}

/** Usa un token de recuperación: cambia la contraseña y cierra todas las sesiones del usuario. */
export async function consumeReset(token: string, password: string) {
  const r = await db.passwordReset.findUnique({ where: { id: tokenHash(token) } });
  if (!r || r.usedAt || r.expiresAt < new Date()) throw new AuthError(400, "El link de recuperación no es válido o ya venció");
  const passwordHash = await hashPassword(password);
  await db.$transaction([
    db.passwordReset.update({ where: { id: r.id }, data: { usedAt: new Date() } }),
    db.user.update({ where: { id: r.userId }, data: { passwordHash } }),
    db.session.deleteMany({ where: { userId: r.userId } }),
  ]);
  return r.userId;
}
