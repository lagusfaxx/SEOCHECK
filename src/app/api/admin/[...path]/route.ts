import { db } from "@/lib/db";
import { AuthError, isInstanceAdmin, requireUser } from "@/lib/auth";
import { workerAlive } from "@/lib/jobs";
import { monthStart } from "@/lib/budget";
import { isPlan, resolvePlan } from "@/lib/plans";
import { productionChecks } from "@/lib/prodcheck";

export const dynamic = "force-dynamic";

const fail = (error: string, status = 400) => Response.json({ error }, { status });
const days = (n: number) => new Date(Date.now() - n * 864e5);

type Ctx = { url: URL; body: any; me: { id: string } };

const GETS: Record<string, (c: Ctx) => Promise<unknown>> = {
  async overview() {
    const since = monthStart();
    const [users, verified, new7, new30, active7, disabled, workspaces, projects, jobs24, jobsErr24, spend, posts] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { emailVerifiedAt: { not: null } } }),
      db.user.count({ where: { createdAt: { gte: days(7) } } }),
      db.user.count({ where: { createdAt: { gte: days(30) } } }),
      db.user.count({ where: { sessions: { some: { lastSeenAt: { gte: days(7) } } } } }),
      db.user.count({ where: { disabledAt: { not: null } } }),
      db.workspace.count(),
      db.project.count(),
      db.jobRun.count({ where: { createdAt: { gte: days(1) } } }),
      db.jobRun.count({ where: { createdAt: { gte: days(1) }, status: "error" } }),
      db.providerUsage.aggregate({ where: { createdAt: { gte: since } }, _sum: { costUsd: true } }),
      db.socialPost.count({ where: { status: "published" } }),
    ]);
    const signups = await db.$queryRaw<{ d: Date; n: number }[]>`
      SELECT date_trunc('day', "createdAt") AS d, COUNT(*)::int AS n FROM "User" WHERE "createdAt" >= ${days(30)} GROUP BY 1 ORDER BY 1`;
    return { users, verified, new7, new30, active7, disabled, workspaces, projects, jobs24, jobsErr24, spendMonth: spend._sum.costUsd ?? 0, postsPublished: posts, signups, workerAlive: await workerAlive() };
  },

  async users({ url }) {
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 100);
    const rows = await db.user.findMany({
      where: q ? { OR: [{ email: { contains: q } }, { name: { contains: q, mode: "insensitive" } }] } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true, email: true, name: true, createdAt: true, lastLoginAt: true, emailVerifiedAt: true, googleSub: true, disabledAt: true,
        memberships: { select: { role: true, workspace: { select: { id: true, name: true, plan: true, trusted: true, trialEndsAt: true, planValidUntil: true, _count: { select: { projects: true } } } } } },
      },
    });
    return rows.map(({ googleSub, emailVerifiedAt, memberships, ...u }) => ({
      ...u,
      verified: Boolean(emailVerifiedAt),
      google: Boolean(googleSub),
      memberships: memberships.map((m) => ({ role: m.role, workspace: { id: m.workspace.id, name: m.workspace.name, trusted: m.workspace.trusted, projects: m.workspace._count.projects, planLabel: resolvePlan(m.workspace).limits.label } })),
    }));
  },

  async workspaces() {
    const since = monthStart();
    const ws = await db.workspace.findMany({
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { id: true, name: true, plan: true, trusted: true, trialEndsAt: true, planValidUntil: true, createdAt: true, _count: { select: { projects: true, members: true } }, projects: { select: { id: true } } },
    });
    const spend = await db.providerUsage.groupBy({ by: ["projectId"], where: { createdAt: { gte: since }, projectId: { not: null } }, _sum: { costUsd: true } });
    const byProject = new Map(spend.map((s) => [s.projectId, s._sum.costUsd ?? 0]));
    return ws.map(({ projects, ...w }) => {
      const r = resolvePlan(w);
      return { ...w, effectivePlan: r.key, planLabel: r.limits.label, expired: r.expired, spendMonth: projects.reduce((t, p) => t + (byProject.get(p.id) ?? 0), 0) };
    });
  },

  async checks() {
    const alive = await workerAlive();
    return [...productionChecks(), { key: "worker", label: "Worker (trabajos en segundo plano)", level: alive ? "ok" : "error", detail: alive ? "Activo" : "No responde: revisa el servicio worker" }];
  },
};

const POSTS: Record<string, (c: Ctx) => Promise<unknown>> = {
  /** {userId, disabled}: suspender o reactivar una cuenta (cierra sus sesiones) */
  async "users/status"({ body, me }) {
    const userId = String(body.userId ?? "");
    if (userId === me.id) throw new AuthError(400, "No puedes suspender tu propia cuenta");
    if (body.disabled && (await isInstanceAdmin(userId))) throw new AuthError(400, "No se puede suspender a un administrador de la instancia");
    await db.user.update({ where: { id: userId }, data: { disabledAt: body.disabled ? new Date() : null } });
    if (body.disabled) await db.session.deleteMany({ where: { userId } });
    return { ok: true };
  },
  /** {userId}: marcar el correo como verificado a mano */
  async "users/verify"({ body }) {
    await db.user.updateMany({ where: { id: String(body.userId ?? ""), emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
    return { ok: true };
  },
  /** {workspaceId, plan}: asignar plan a mano (sin cobro) */
  async "workspaces/plan"({ body }) {
    const plan = String(body.plan ?? "");
    if (!isPlan(plan)) throw new AuthError(400, "Plan inválido");
    const w = await db.workspace.findUniqueOrThrow({ where: { id: String(body.workspaceId ?? "") }, select: { trusted: true } });
    if (w.trusted) throw new AuthError(400, "El workspace de la instancia no tiene plan");
    await db.workspace.update({ where: { id: String(body.workspaceId) }, data: { plan, planValidUntil: null } });
    return { ok: true };
  },
};

function make(table: Record<string, (c: Ctx) => Promise<unknown>>) {
  return async (req: Request, { params }: { params: { path: string[] } }) => {
    const h = table[params.path.join("/")];
    if (!h) return fail("not found", 404);
    try {
      const me = await requireUser(req);
      // sin permiso: 404, no se revela que el panel existe
      if (!(await isInstanceAdmin(me.id))) return fail("not found", 404);
      const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
      return Response.json(await h({ url: new URL(req.url), body, me }));
    } catch (e) {
      if (e instanceof AuthError) return fail(e.message, e.status);
      console.error("[admin]", e);
      return fail(e instanceof Error ? e.message : "Error interno", 500);
    }
  };
}

export const GET = make(GETS);
export const POST = make(POSTS);
