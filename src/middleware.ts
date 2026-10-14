import { NextResponse, type NextRequest } from "next/server";

/** Sitio público de Fullstack Ventures (landing y páginas de producto). */
const SITE = [/^\/$/, /^\/search$/, /^\/ventures$/, /^\/capacidades$/, /^\/work$/, /^\/empresa$/, /^\/privacidad(\/eliminacion)?$/, /^\/terminos$/, /^\/robots\.txt$/, /^\/sitemap\.xml$/, /^\/brand\//, /^\/api\/ideas$/];
/** Rutas de la app que se pueden ver sin sesión. */
const PUBLIC = [/^\/login$/, /^\/signup$/, /^\/setup$/, /^\/forgot$/, /^\/reset$/, /^\/api\/auth\//, /^\/api\/health$/, /^\/api\/oauth\/google\/callback$/, /^\/api\/oauth\/meta\/callback$/];

/**
 * Primera barrera (edge): sin cookie de sesión no se entra; la sesión y los permisos se validan de verdad en cada
 * ruta de la API (Node). Además: CSRF por Origin en métodos que modifican, y BASIC_AUTH opcional encima de todo.
 */
export function middleware(req: NextRequest) {
  // Stripe y Mercado Pago firman sus webhooks (y el de Mercado Pago se relee en su API): sin cookie ni BASIC_AUTH
  if (/^\/api\/billing\/(webhook|mercadopago)$/.test(req.nextUrl.pathname) && req.method === "POST") return NextResponse.next();
  const { pathname } = req.nextUrl;
  // healthcheck de Docker/Coolify: siempre abierto. Si responde 401, el contenedor queda "unhealthy"
  // y el proxy (Traefik) deja de enrutar el sitio: se ve "404 page not found".
  if (pathname === "/api/health") return NextResponse.next();
  // Instagram descarga las imágenes de los posts desde acá: sin BASIC_AUTH ni sesión
  if (req.method === "GET" && /^\/api\/social\/image\/[a-z0-9]+$/.test(pathname)) return NextResponse.next();
  // Meta firma estas notificaciones con el app secret (signed_request); no traen cookie ni BASIC_AUTH
  if (req.method === "POST" && /^\/api\/oauth\/meta\/(deauthorize|data-deletion)$/.test(pathname)) return NextResponse.next();
  // el sitio público (landing, productos y sus imágenes) nunca va detrás de BASIC_AUTH ni de la sesión
  if (SITE.some((r) => r.test(pathname))) return NextResponse.next();
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
  url.search = `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
