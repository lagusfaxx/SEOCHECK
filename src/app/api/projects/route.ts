import { createProjectWithinPlan, PlanLimitError } from "@/lib/plans";
import { db } from "@/lib/db";
import { normDomain } from "@/lib/util";
import { normalizeGscProperty } from "@/lib/providers/google";
import { AuthError, requireUser, requireWorkspace, userWorkspaceIds } from "@/lib/auth";

export const dynamic = "force-dynamic";

const LOCATIONS: Record<string, number> = { cl: 2152, ar: 2032, mx: 2484, co: 2170, pe: 2604, es: 2724, us: 2840, uy: 2858 };
const fail = (msg: string, status = 400) => Response.json({ error: msg }, { status });

/** Proyectos de los workspaces del usuario (nunca los de otros). */
export async function GET(req: Request) {
  try {
    const u = await requireUser(req);
    const projects = await db.project.findMany({ where: { workspaceId: { in: await userWorkspaceIds(u.id) } }, orderBy: { createdAt: "asc" } });
    return Response.json(projects);
  } catch (e) {
    return e instanceof AuthError || e instanceof PlanLimitError ? fail(e.message, e.status) : fail("Error interno", 500);
  }
}

export async function POST(req: Request) {
  try {
    const u = await requireUser(req);
    const b = await req.json().catch(() => ({}));
    if (!b.domain) return fail("Falta el dominio");
    // en el workspace pedido (si es suyo) o en el primero del usuario
    const workspaceId = b.workspaceId ?? (await db.membership.findFirst({ where: { userId: u.id }, orderBy: { createdAt: "asc" } }))?.workspaceId;
    if (!workspaceId) return fail("No tienes un workspace", 403);
    await requireWorkspace(u.id, workspaceId, "admin");
    if (b.gscProperty) {
      try {
        normalizeGscProperty(b.gscProperty);
      } catch (e) {
        return fail((e as Error).message);
      }
    }
    const country = String(b.country ?? "cl").toLowerCase();
    const domain = normDomain(String(b.domain));
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return fail("Dominio inválido");
    const p = await createProjectWithinPlan(workspaceId, {
        workspaceId,
        name: b.name || domain,
        domain,
        country,
        language: b.language ?? "es",
        locationCode: b.locationCode ?? LOCATIONS[country] ?? 2152,
        gscProperty: b.gscProperty ? normalizeGscProperty(b.gscProperty) : null,
    });
    return Response.json(p);
  } catch (e) {
    return e instanceof AuthError || e instanceof PlanLimitError ? fail(e.message, e.status) : fail("Error interno", 500);
  }
}
