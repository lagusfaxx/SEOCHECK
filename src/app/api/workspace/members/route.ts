import { db } from "@/lib/db";
import { AuthError, createReset, hashPassword, newToken, normEmail, rateLimit, requireUser, requireWorkspace, validEmail } from "@/lib/auth";
import { sendMail } from "@/lib/mail";

export const dynamic = "force-dynamic";

const fail = (msg: string, status = 400) => Response.json({ error: msg }, { status });
const appUrl = (req: Request) => (process.env.APP_URL ?? new URL(req.url).origin).replace(/\/$/, "");

async function wsOf(req: Request, userId: string) {
  const ws = new URL(req.url).searchParams.get("workspace") ?? (await db.membership.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } }))?.workspaceId;
  if (!ws) throw new AuthError(404, "Sin workspace");
  return ws;
}

/** Miembros del workspace */
export async function GET(req: Request) {
  try {
    const u = await requireUser(req);
    const ws = await wsOf(req, u.id);
    await requireWorkspace(u.id, ws);
    const ms = await db.membership.findMany({ where: { workspaceId: ws }, include: { user: { select: { id: true, email: true, name: true, lastLoginAt: true } } }, orderBy: { createdAt: "asc" } });
    return Response.json(ms.map((m) => ({ ...m.user, role: m.role })));
  } catch (e) {
    return e instanceof AuthError ? fail(e.message, e.status) : fail("Error interno", 500);
  }
}

/**
 * Invitar {email, role}: si el email no tiene cuenta se crea con una contraseña aleatoria y se le manda
 * un link para elegir la suya. Solo owner/admin; solo un owner puede dar rol owner.
 */
export async function POST(req: Request) {
  try {
    const u = await requireUser(req);
    const ws = await wsOf(req, u.id);
    const myRole = await requireWorkspace(u.id, ws, "admin");
    const r = await rateLimit(`invite:${u.id}`, 30, 60 * 60_000);
    if (!r.ok) return fail("Demasiadas invitaciones seguidas", 429);
    const b = await req.json().catch(() => ({}));
    const email = normEmail(b.email);
    const role = ["owner", "admin", "member"].includes(b.role) ? b.role : "member";
    if (!validEmail(email)) return fail("Email inválido");
    if (role === "owner" && myRole !== "owner") return fail("Solo un dueño puede agregar otro dueño", 403);
    let user = await db.user.findUnique({ where: { email } });
    let link: string | null = null;
    if (!user) {
      user = await db.user.create({ data: { email, passwordHash: await hashPassword(newToken()) } });
      // 7 días para aceptar la invitación eligiendo su contraseña
      link = `${appUrl(req)}/reset?token=${await createReset(user.id, 24 * 7)}&invite=1`;
    }
    await db.membership.upsert({ where: { userId_workspaceId: { userId: user.id, workspaceId: ws } }, create: { userId: user.id, workspaceId: ws, role }, update: { role } });
    const sent = await sendMail(email, "Te invitaron a SEOCHECK", link ? `Para entrar, elige tu contraseña aquí (vence en 7 días):\n\n${link}` : `Ya tienes acceso: entra en ${appUrl(req)}/login`, link ?? undefined);
    // sin proveedor de correo, quien invita recibe el link para entregarlo a mano
    return Response.json({ ok: true, email, role, link: sent === "logged" ? link : null });
  } catch (e) {
    return e instanceof AuthError ? fail(e.message, e.status) : fail("Error interno", 500);
  }
}

/** Quitar {userId}. No se puede dejar el workspace sin dueño. */
export async function DELETE(req: Request) {
  try {
    const u = await requireUser(req);
    const ws = await wsOf(req, u.id);
    await requireWorkspace(u.id, ws, "admin");
    const b = await req.json().catch(() => ({}));
    const target = await db.membership.findUnique({ where: { userId_workspaceId: { userId: String(b.userId), workspaceId: ws } } });
    if (!target) return fail("no existe", 404);
    if (target.role === "owner" && (await db.membership.count({ where: { workspaceId: ws, role: "owner" } })) <= 1) return fail("No puedes quitar al único dueño", 400);
    await db.membership.delete({ where: { userId_workspaceId: { userId: target.userId, workspaceId: ws } } });
    // sus sesiones siguen sirviendo para otros workspaces; aquí ya no tiene acceso
    return Response.json({ ok: true });
  } catch (e) {
    return e instanceof AuthError ? fail(e.message, e.status) : fail("Error interno", 500);
  }
}
