/**
 * Iniciar sesión / registrarse con Google (OpenID Connect). Usa el mismo cliente OAuth que Search Console,
 * con su propia URL de retorno. State y PKCE viajan en una cookie httpOnly de 10 minutos.
 */
import { createHash, randomBytes } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { db } from "./db";
import { hashPassword, newToken } from "./auth";
import { appBaseUrl } from "./util";

export const GOOGLE_COOKIE = "sc_glogin";
export const googleLoginEnabled = () => Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
const redirectUri = (origin: string) => `${appBaseUrl(origin)}/api/auth/google-login/callback`;
const client = (origin: string) => new OAuth2Client(process.env.GOOGLE_OAUTH_CLIENT_ID, process.env.GOOGLE_OAUTH_CLIENT_SECRET, redirectUri(origin));

/** URL de Google y el valor de la cookie (state.verifier.next). */
export function googleStart(origin: string, next: string): { url: string; cookie: string } {
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const url = client(origin).generateAuthUrl({
    scope: ["openid", "email", "profile"],
    state,
    prompt: "select_account",
    code_challenge_method: "S256" as never,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  });
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/app";
  return { url, cookie: `${state}.${verifier}.${Buffer.from(safeNext).toString("base64url")}` };
}

export class GoogleLoginError extends Error {}

/** Valida state, canjea el code y devuelve el usuario (lo crea si el registro está abierto). */
export async function googleFinish(origin: string, cookie: string | null, state: string, code: string, signupOpen: boolean) {
  const [st, verifier, nextB64] = (cookie ?? "").split(".");
  if (!st || !verifier || st !== state) throw new GoogleLoginError("La autorización venció: vuelve a intentarlo");
  const c = client(origin);
  const { tokens } = await c.getToken({ code, codeVerifier: verifier });
  if (!tokens.id_token) throw new GoogleLoginError("Google no confirmó tu identidad");
  const payload = (await c.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_OAUTH_CLIENT_ID }))?.getPayload();
  if (!payload?.sub || !payload.email || !payload.email_verified) throw new GoogleLoginError("Tu cuenta de Google no tiene un correo verificado");
  const email = payload.email.trim().toLowerCase();
  const next = nextB64 ? Buffer.from(nextB64, "base64url").toString("utf8") : "/app";

  let user = await db.user.findUnique({ where: { googleSub: payload.sub } });
  if (!user) {
    const byEmail = await db.user.findUnique({ where: { email } });
    if (byEmail) {
      // mismo correo, verificado por Google: se vincula a la cuenta existente
      user = await db.user.update({ where: { id: byEmail.id }, data: { googleSub: payload.sub, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date() } });
    } else {
      if (!signupOpen) throw new GoogleLoginError("No hay una cuenta con ese correo y el registro está cerrado: pide una invitación");
      user = await db.user.create({
        data: {
          email,
          name: payload.name?.slice(0, 100) ?? null,
          googleSub: payload.sub,
          // sin contraseña usable: puede crear una con "¿Olvidaste tu contraseña?"
          passwordHash: await hashPassword(newToken()),
          emailVerifiedAt: new Date(),
          termsAcceptedAt: new Date(),
          memberships: { create: { role: "owner", workspace: { create: { name: payload.name?.slice(0, 100) || email.split("@")[0] } } } },
        },
      });
    }
  }
  if (user.disabledAt) throw new GoogleLoginError("Tu cuenta está suspendida. Escríbenos a contacto@fsvc.cl si crees que es un error.");
  return { user, next: next.startsWith("/") && !next.startsWith("//") ? next : "/app" };
}
