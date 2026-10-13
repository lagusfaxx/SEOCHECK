import { db } from "@/lib/db";
import { tokenHash, userFromRequest } from "@/lib/auth";
import { appBaseUrl } from "@/lib/util";
import { finish } from "@/lib/providers/meta";

export const dynamic = "force-dynamic";

/** Meta vuelve acá después del consentimiento. Valida, guarda la conexión y redirige al proyecto. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = appBaseUrl(url.origin);
  const back = (projectId: string | null, q: string) =>
    Response.redirect(`${base}${projectId ? `/p/${projectId}/social` : "/app"}?${q}`, 302);

  const err = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  // el proyecto sale del state antes de canjearlo: si algo falla, el error se muestra en la pantalla del proyecto
  const stateProject = state ? ((await db.oAuthState.findUnique({ where: { id: tokenHash(state) }, select: { projectId: true } }))?.projectId ?? null) : null;
  const user = await userFromRequest(req);
  if (!user) {
    console.error("[meta] callback sin sesión: el navegador no envió la cookie al volver de Instagram");
    return Response.redirect(`${base}/login?next=${encodeURIComponent(stateProject ? `/p/${stateProject}/social` : "/app")}&error=${encodeURIComponent("Tu sesión no se reconoció al volver de Instagram: inicia sesión y vuelve a conectar")}`, 302);
  }

  if (err || !code)
    return back(stateProject, `meta_error=${encodeURIComponent(err === "access_denied" ? "Cancelaste la autorización en Meta" : err ?? "Sin código de autorización")}`);

  let projectId = stateProject;
  try {
    projectId = await finish(state, code, user.id, url.origin);
    return back(projectId, "meta=ok");
  } catch (e) {
    console.error("[meta] callback", projectId, e instanceof Error ? e.message : e);
    return back(projectId, `meta_error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
}
