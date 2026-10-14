import { clientIp, rateLimit } from "@/lib/auth";
import { FreeAuditError, runFreeAudit } from "@/lib/free-audit";

export const runtime = "nodejs";
const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Auditoría gratis de una página (sin sesión): rate limit por IP y uno global para que no se use como proxy. */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!(await rateLimit(`freeaudit:${ip}`, 5, 60 * 60_000)).ok)
    return json({ error: "Ya hiciste varias auditorías gratis en la última hora. Crea tu cuenta para auditar sitios completos." }, 429);
  if (!(await rateLimit("freeaudit:all", 300, 60 * 60_000)).ok) return json({ error: "Hay muchas auditorías en curso. Intenta de nuevo en unos minutos." }, 429);
  const b = (await req.json().catch(() => ({}))) as { url?: unknown };
  try {
    return json(await runFreeAudit(b.url));
  } catch (e) {
    if (e instanceof FreeAuditError) return json({ error: e.message }, 400);
    if (e instanceof Error && e.name === "SsrfError") return json({ error: "Esa dirección no se puede auditar." }, 400);
    console.error("[free-audit]", e);
    return json({ error: "No pudimos auditar el sitio. Intenta de nuevo." }, 500);
  }
}
