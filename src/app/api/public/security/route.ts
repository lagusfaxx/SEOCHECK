import { clientIp, rateLimit } from "@/lib/auth";
import { FreeAuditError } from "@/lib/free-audit";
import { runSecurityCheck } from "@/lib/security-check";

export const runtime = "nodejs";
const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Revisión pasiva de seguridad (sin sesión): rate limit por IP y uno global. */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!(await rateLimit(`seccheck:${ip}`, 5, 60 * 60_000)).ok) return json({ error: "Ya hiciste varias revisiones en la última hora. Para una evaluación completa, entra a pentest.fsvc.cl." }, 429);
  if (!(await rateLimit("seccheck:all", 300, 60 * 60_000)).ok) return json({ error: "Hay muchas revisiones en curso. Intenta de nuevo en unos minutos." }, 429);
  const b = (await req.json().catch(() => ({}))) as { url?: unknown };
  try {
    return json(await runSecurityCheck(b.url));
  } catch (e) {
    if (e instanceof FreeAuditError) return json({ error: e.message }, 400);
    if (e instanceof Error && e.name === "SsrfError") return json({ error: "Esa dirección no se puede revisar." }, 400);
    console.error("[security-check]", e);
    return json({ error: "No pudimos revisar el sitio. Intenta de nuevo." }, 500);
  }
}
