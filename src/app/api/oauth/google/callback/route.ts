import { db } from "@/lib/db";
import { tokenHash, userFromRequest } from "@/lib/auth";
import { appBaseUrl } from "@/lib/util";
import { finish } from "@/lib/gsc-oauth";
import { autoSyncGsc } from "@/lib/gsc-autosync";
import { gscSites, matchGscProperty } from "@/lib/providers/google";

export const dynamic = "force-dynamic";

/** Google vuelve acá después del consentimiento. Valida, guarda la conexión y elige la propiedad del dominio. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = appBaseUrl(url.origin);
  const back = (projectId: string | null, q: string) => Response.redirect(`${base}${projectId ? `/p/${projectId}/settings` : "/app"}?${q}#gsc`, 302);
  const user = await userFromRequest(req);
  if (!user) return Response.redirect(`${base}/login`, 302);
  const err = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  // el proyecto sale del state antes de canjearlo: si algo falla, el error se muestra en la pantalla del proyecto
  const stateProject = state ? ((await db.oAuthState.findUnique({ where: { id: tokenHash(state) }, select: { projectId: true } }))?.projectId ?? null) : null;
  if (err || !code) return back(stateProject, `gsc_error=${encodeURIComponent(err === "access_denied" ? "Cancelaste la autorización en Google" : err ?? "Sin código de autorización")}`);
  let projectId = stateProject;
  try {
    projectId = await finish(state, code, user.id, url.origin);
    // elegir sola la propiedad que corresponde al dominio del proyecto
    const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    const sites = await gscSites(projectId).catch(() => [] as string[]);
    const match = matchGscProperty(p.gscProperty ?? p.domain, sites);
    if (match && match !== p.gscProperty) await db.project.update({ where: { id: projectId }, data: { gscProperty: match } });
    if (match) await autoSyncGsc(projectId).catch((e) => console.error("[gsc] sincronización automática", e));
    return back(projectId, match ? "gsc=ok" : `gsc_error=${encodeURIComponent(`Conectado, pero la cuenta no tiene ninguna propiedad de ${p.domain}. Propiedades que ve: ${sites.join(", ") || "ninguna"}`)}`);
  } catch (e) {
    return back(projectId, `gsc_error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
}
