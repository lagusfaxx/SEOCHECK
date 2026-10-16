import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { tokenHash, memLimit } from "@/lib/auth";
import { build } from "@/lib/pro/data";
import { ProError } from "@/lib/pro/types";
export const dynamic = "force-dynamic";
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; module: string } },
) {
  const raw = req.headers
    .get("authorization")
    ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!raw) return Response.json({ error: "Token requerido" }, { status: 401 });
  const token = await db.apiToken.findFirst({
    where: { projectId: params.id, tokenHash: tokenHash(raw), revokedAt: null },
  });
  if (!token)
    return Response.json({ error: "Token inválido" }, { status: 401 });
  if (!memLimit(`expert-token:${token.id}`, 60, 60000))
    return Response.json({ error: "Límite de solicitudes" }, { status: 429 });
  try {
    if (
      ![
        "crawl",
        "templates",
        "structure",
        "index",
        "arch",
        "perf",
        "shop",
        "serp",
        "content",
        "analytics",
      ].includes(params.module)
    )
      throw new ProError("Módulo no encontrado", 404);
    const result = await build(params.module, params.id);
    await db.apiToken.update({
      where: { id: token.id },
      data: { lastUsedAt: new Date() },
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ProError)
      return Response.json({ error: e.message }, { status: e.status });
    console.error("expert API", e);
    return Response.json(
      { error: "No se pudo obtener el análisis" },
      { status: 500 },
    );
  }
}
