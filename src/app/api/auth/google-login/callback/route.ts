import { clientIp, createSession, isSecure, rateLimit, readCookie, sessionCookie, signupEnabled } from "@/lib/auth";
import { GOOGLE_COOKIE, googleFinish, GoogleLoginError } from "@/lib/google-login";
import { appBaseUrl } from "@/lib/util";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = appBaseUrl(url.origin);
  const clear = `${GOOGLE_COOKIE}=; Path=/api/auth/google-login; HttpOnly; SameSite=Lax; Max-Age=0${isSecure(req) ? "; Secure" : ""}`;
  const toLogin = (msg: string) => new Response(null, { status: 302, headers: [["Location", `${base}/login?error=${encodeURIComponent(msg)}`], ["Set-Cookie", clear]] });

  if (url.searchParams.get("error")) return toLogin(url.searchParams.get("error") === "access_denied" ? "Cancelaste el inicio con Google" : "Google no completó el inicio de sesión");
  const code = url.searchParams.get("code");
  if (!code) return toLogin("Google no devolvió un código de autorización");
  if (!(await rateLimit(`glogin:${clientIp(req)}`, 30, 15 * 60_000)).ok) return toLogin("Demasiados intentos: espera unos minutos");
  try {
    const { user, next } = await googleFinish(url.origin, readCookie(req.headers.get("cookie"), GOOGLE_COOKIE), url.searchParams.get("state") ?? "", code, signupEnabled());
    const { token, expiresAt } = await createSession(user.id, { ip: clientIp(req), userAgent: req.headers.get("user-agent") });
    return new Response(null, { status: 302, headers: [["Location", `${base}${next}`], ["Set-Cookie", clear], ["Set-Cookie", sessionCookie(token, expiresAt, isSecure(req))]] });
  } catch (e) {
    if (!(e instanceof GoogleLoginError)) console.error("[auth] google", e);
    return toLogin(e instanceof GoogleLoginError ? e.message : "No se pudo iniciar sesión con Google: intenta de nuevo");
  }
}
