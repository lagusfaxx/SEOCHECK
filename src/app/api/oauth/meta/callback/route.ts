import { userFromRequest } from "@/lib/auth";
import { finish } from "@/lib/providers/meta";

export const dynamic = "force-dynamic";

/** Meta vuelve acá después del consentimiento. Valida, guarda la conexión y redirige al proyecto. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = (process.env.APP_URL ?? url.origin).replace(/\/$/, "");
  const back = (projectId: string | null, q: string) =>
    Response.redirect(`${base}${projectId ? `/p/${projectId}/social` : "/app"}?${q}`, 302);

  const user = await userFromRequest(req);
  if (!user) return Response.redirect(`${base}/login`, 302);

  const err = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";

  if (err || !code)
    return back(null, `meta_error=${encodeURIComponent(err === "access_denied" ? "Cancelaste la autorización en Meta" : err ?? "Sin código de autorización")}`);

  let projectId: string | null = null;
  try {
    projectId = await finish(state, code, user.id, url.origin);
    return back(projectId, "meta=ok");
  } catch (e) {
    return back(projectId, `meta_error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
}
