import { db } from "@/lib/db";
import { normDomain } from "@/lib/util";

export const dynamic = "force-dynamic";

const LOCATIONS: Record<string, number> = { cl: 2152, ar: 2032, mx: 2484, co: 2170, pe: 2604, es: 2724, us: 2840, uy: 2858 };

export async function GET() {
  const projects = await db.project.findMany({ orderBy: { createdAt: "asc" } });
  return Response.json(projects);
}

export async function POST(req: Request) {
  const b = await req.json();
  if (!b.domain) return Response.json({ error: "domain" }, { status: 400 });
  let ws = await db.workspace.findFirst();
  if (!ws) ws = await db.workspace.create({ data: { name: "default" } });
  const country = (b.country ?? "cl").toLowerCase();
  const domain = normDomain(b.domain);
  const p = await db.project.create({
    data: {
      workspaceId: ws.id,
      name: b.name || domain,
      domain,
      country,
      language: b.language ?? "es",
      locationCode: b.locationCode ?? LOCATIONS[country] ?? 2152,
      gscProperty: b.gscProperty || null,
    },
  });
  return Response.json(p);
}
