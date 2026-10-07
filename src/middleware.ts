import { NextResponse, type NextRequest } from "next/server";

/** Basic auth opcional: BASIC_AUTH=usuario:clave */
export function middleware(req: NextRequest) {
  const cred = process.env.BASIC_AUTH;
  if (!cred) return NextResponse.next();
  const h = req.headers.get("authorization");
  if (h?.startsWith("Basic ") && atob(h.slice(6)) === cred) return NextResponse.next();
  return new NextResponse("auth", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="seo"' } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"] };
