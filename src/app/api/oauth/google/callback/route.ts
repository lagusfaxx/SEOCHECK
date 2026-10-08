import { db } from "@/lib/db";
import { userFromRequest } from "@/lib/auth";
import { finish } from "@/lib/gsc-oauth";
import { gscSites, matchGscProperty } from "@/lib/providers/google";

export const dynamic = "force-dynamic";

/** Google vuelve acá después del consentimiento. Valida, guarda la conexión y elige la propiedad del dominio. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = (process.env.APP_URL ?? url.origin).replace(/\/$/, "");
  const back = (projectId: string | null, q: string) => Response.redirect(`${base}${projectId ? `/p/${projectId}/settings` : "/"}?${q}#gsc`, 302);
  const user = await userFromRequest(req);
  if (!user) return Response.redirect(`${base}/login`, 302);
  const err = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  if (err || !code) return back(null, `gsc_error=${encodeURIComponent(err === "access_denied" ? "Cancelaste la autorización en Google" : err ?? "Sin código de autorización")}`);
  let projectId: string | null = null;
  try {
    projectId = await finish(state, code, user.id, url.origin);
    // elegir sola la propiedad que corresponde al dominio del proyecto
    const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    const sites = await gscSites(projectId).catch(() => [] as string[]);
    const match = matchGscProperty(p.gscProperty ?? p.domain, sites);
    if (match && match !== p.gscProperty) await db.project.update({ where: { id: projectId }, data: { gscProperty: match } });
    return back(projectId, match ? "gsc=ok" : `gsc_error=${encodeURIComponent(`Conectado, pero la cuenta no tiene ninguna propiedad de ${p.domain}. Propiedades que ve: ${sites.join(", ") || "ninguna"}`)}`);
  } catch (e) {
    return back(projectId, `gsc_error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
}
