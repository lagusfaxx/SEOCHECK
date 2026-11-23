import { livePayload, recordPing } from "@/lib/fixes/service";
import { headFor, liveScript, opsFor, redirectFor } from "@/lib/fixes/live";
import { appBaseUrl } from "@/lib/util";
import { memLimit } from "@/lib/auth";

export const dynamic = "force-dynamic";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "cross-origin-resource-policy": "cross-origin", "x-robots-tag": "noindex" };
const GIF = Buffer.from("R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", "base64");

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * Publicación en vivo, sin sesión: la clave de la URL identifica el sitio y solo entrega correcciones aprobadas.
 *   s.js       script que aplica las correcciones en el navegador
 *   page.json  lo mismo para una página (?u=/ruta), para aplicarlo desde el servidor del sitio
 *   ping       aviso de instalación
 */
export async function GET(req: Request, { params }: { params: { key: string; file: string } }) {
  const url = new URL(req.url);
  const base = `${appBaseUrl(url.origin)}/api/live/${params.key}`;
  const entry = await livePayload(params.key);
  if (params.file === "s.js") {
    // clave desconocida o publicación en pausa: script vacío (nunca un error en el sitio del cliente)
    const body = entry?.payload ? liveScript(base, entry.payload) : "/* FSV Search: sin correcciones publicadas */";
    return new Response(body, { status: entry ? 200 : 404, headers: { ...CORS, "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=300, stale-while-revalidate=3600" } });
  }
  if (params.file === "page.json") {
    if (!entry) return Response.json({ error: "no existe" }, { status: 404, headers: CORS });
    // el plugin de WordPress se identifica: cuenta como instalación vista
    if (req.headers.get("x-fsv-plugin")) await recordPing(params.key, `${url.searchParams.get("u") ?? "/"} (plugin WordPress)`).catch(() => {});
    const u = url.searchParams.get("u") ?? url.searchParams.get("url") ?? "/";
    const body = entry.payload ? { ops: opsFor(entry.payload, u), head: headFor(entry.payload, u), redirect: redirectFor(entry.payload, u) } : { ops: [], head: null, redirect: null };
    return Response.json(body, { headers: { ...CORS, "cache-control": "public, max-age=300, stale-while-revalidate=3600" } });
  }
  if (params.file === "ping") {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "x";
    if (entry && memLimit(`liveping:${ip}`, 30, 60_000)) await recordPing(params.key, url.searchParams.get("u") ?? "/").catch(() => {});
    return new Response(GIF, { headers: { ...CORS, "content-type": "image/gif", "cache-control": "no-store" } });
  }
  return new Response("no existe", { status: 404 });
}
