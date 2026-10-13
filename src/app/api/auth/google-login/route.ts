import { isSecure } from "@/lib/auth";
import { GOOGLE_COOKIE, googleLoginEnabled, googleStart } from "@/lib/google-login";
import { appBaseUrl } from "@/lib/util";

export const dynamic = "force-dynamic";

/** GET ?next=/ruta: redirige a Google para iniciar sesión. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = appBaseUrl(url.origin);
  if (!googleLoginEnabled()) return Response.redirect(`${base}/login?error=${encodeURIComponent("El inicio con Google no está habilitado")}`, 302);
  const { url: to, cookie } = googleStart(url.origin, url.searchParams.get("next") ?? "/app");
  return new Response(null, {
    status: 302,
    headers: {
      Location: to,
      "Set-Cookie": `${GOOGLE_COOKIE}=${cookie}; Path=/api/auth/google-login; HttpOnly; SameSite=Lax; Max-Age=600${isSecure(req) ? "; Secure" : ""}`,
    },
  });
}
