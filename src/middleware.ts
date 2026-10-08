import { NextResponse, type NextRequest } from "next/server";

/** Rutas que se pueden ver sin sesión. */
const PUBLIC = [/^\/login$/, /^\/setup$/, /^\/forgot$/, /^\/reset$/, /^\/api\/auth\//, /^\/api\/health$/, /^\/api\/oauth\/google\/callback$/];

/**
 * Primera barrera (edge): sin cookie de sesión no se entra; la sesión y los permisos se validan de verdad en cada
 * ruta de la API (Node). Además: CSRF por Origin en métodos que modifican, y BASIC_AUTH opcional encima de todo.
 */
export function middleware(req: NextRequest) {
  // Stripe authenticates this exact endpoint with its signed raw payload, not browser cookies or Basic Auth.
  if (req.nextUrl.pathname === "/api/billing/webhook" && req.method === "POST") return NextResponse.next();
  const { pathname } = req.nextUrl;
  // healthcheck de Docker/Coolify: siempre abierto. Si responde 401, el contenedor queda "unhealthy"
  // y el proxy (Traefik) deja de enrutar el sitio: se ve "404 page not found".
  if (pathname === "/api/health") return NextResponse.next();
  const cred = process.env.BASIC_AUTH;
  if (cred) {
    const h = req.headers.get("authorization");
    if (!(h?.startsWith("Basic ") && atob(h.slice(6)) === cred)) return new NextResponse("auth", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="seo"' } });
  }
  // CSRF: un POST/PATCH/DELETE desde otro sitio no puede usar la cookie de sesión
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (origin && host && new URL(origin).host !== host) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  }
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();
  if (req.cookies.get("sc_session")?.value) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Inicia sesión" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
