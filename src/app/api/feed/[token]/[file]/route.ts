import { FEEDS, feedCsv, projectByFeedToken, type Feed } from "@/lib/feed";
import { rateLimit } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** CSV de solo lectura para Google Sheets (IMPORTDATA) y Looker Studio. El token de la URL es la credencial. */
export async function GET(req: Request, { params }: { params: { token: string; file: string } }) {
  const feed = params.file.replace(/\.csv$/, "") as Feed;
  if (!FEEDS.includes(feed)) return new Response("no existe", { status: 404 });
  const projectId = await projectByFeedToken(params.token);
  // mismo 404 para token inválido: no se revela si existe
  if (!projectId) return new Response("no existe", { status: 404 });
  const rl = await rateLimit(`feed:${projectId}`, 120, 60 * 60_000);
  if (!rl.ok) return new Response("demasiadas consultas", { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  return new Response(await feedCsv(projectId, feed), {
    headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "private, max-age=300", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" },
  });
}
