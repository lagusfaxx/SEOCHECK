/**
 * Mientras la app de Meta no pasa la App Review, cada cuenta de Instagram tiene que agregarse a mano como
 * "Instagram Tester". El cliente deja su @, el admin lo agrega en Meta y lo marca como invitado (le llega un correo
 * con los pasos), y al conectar la cuenta la solicitud queda como conectada.
 */
import { db } from "./db";
import { AuthError, rateLimit } from "./auth";
import { mailTemplate, sendMail } from "./mail";

export const IG_REQUEST_STATUS = ["pending", "invited", "connected", "rejected"] as const;
export type IgRequestStatus = (typeof IG_REQUEST_STATUS)[number];

/** "@Usuario", "usuario" o "https://instagram.com/usuario/" → "usuario". */
export function normalizeIgUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let v = raw.trim();
  const m = /instagram\.com\/([^/?#\s]+)/i.exec(v);
  if (m) v = m[1];
  v = v.replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(v) && !/^\.|\.$|\.\./.test(v) ? v : null;
}

async function instanceAdminEmails() {
  const ms = await db.membership.findMany({ where: { role: { in: ["owner", "admin"] }, workspace: { trusted: true } }, select: { user: { select: { email: true, disabledAt: true } } } });
  return [...new Set(ms.filter((m) => !m.user.disabledAt).map((m) => m.user.email))];
}

export async function requestIgAccess(projectId: string, user: { id: string; email: string }, raw: unknown, base: string) {
  const username = normalizeIgUsername(raw);
  if (!username) throw new AuthError(400, "Escribe un usuario de Instagram válido, por ejemplo @tunegocio");
  if (!(await rateLimit(`igreq:${projectId}`, 5, 24 * 3600_000)).ok) throw new AuthError(429, "Ya enviaste varias solicitudes hoy: te avisaremos por correo cuando estén listas");

  const prev = await db.igAccessRequest.findUnique({ where: { projectId_username: { projectId, username } } });
  if (prev && prev.status !== "rejected") return prev;
  const req = prev
    ? await db.igAccessRequest.update({ where: { id: prev.id }, data: { status: "pending", userId: user.id } })
    : await db.igAccessRequest.create({ data: { projectId, userId: user.id, username } });

  const project = await db.project.findUnique({ where: { id: projectId }, select: { domain: true } });
  const m = mailTemplate(
    `Nueva solicitud de Instagram: @${username}`,
    [
      `${user.email} pidió habilitar @${username} para publicar desde el proyecto ${project?.domain ?? projectId}.`,
      "1) En Meta for Developers → tu app → App roles → Roles → Add People → Instagram Tester, agrega a la cuenta.",
      "2) En el panel de administración marca la solicitud como invitada: al usuario le llega un correo con los pasos para aceptar.",
    ],
    { label: "Ver solicitudes", url: `${base}/admin?tab=instagram` },
    "Recibes este correo por ser administrador de FSV Search.",
  );
  for (const to of await instanceAdminEmails()) await sendMail(to, `Solicitud de Instagram: @${username}`, m.text, undefined, m.html).catch((e) => console.error("[ig-access] aviso admin", e));
  return req;
}

export async function setIgRequestStatus(id: string, status: IgRequestStatus, base: string) {
  const req = await db.igAccessRequest.update({ where: { id }, data: { status }, include: { project: { select: { id: true, domain: true } } } });
  if (status === "invited" || status === "rejected") {
    const user = await db.user.findUnique({ where: { id: req.userId }, select: { email: true, disabledAt: true } });
    if (user && !user.disabledAt) {
      const m =
        status === "invited"
          ? mailTemplate(
              `Tu cuenta @${req.username} ya está habilitada`,
              [
                "Te enviamos una invitación desde Instagram para conectar tu cuenta con FSV Search. Solo falta aceptarla:",
                "1) Entra a Instagram con esa cuenta (en el computador es más fácil) y abre Configuración → Apps y sitios web → Invitaciones de evaluador. En la web: instagram.com/accounts/manage_access",
                "2) Acepta la invitación de FSV Search.",
                "3) Vuelve a FSV Search → Social y pulsa Conectar Instagram.",
                "Recuerda que la cuenta tiene que ser profesional (Empresa o Creador).",
              ],
              { label: "Ir a Social", url: `${base}/p/${req.project.id}/social` },
            )
          : mailTemplate(
              `No pudimos habilitar @${req.username}`,
              ["Revisamos tu solicitud y no pudimos habilitar esa cuenta de Instagram. Revisa que el usuario esté bien escrito y que la cuenta sea profesional, y vuelve a enviarla desde Social. Si tienes dudas, responde a contacto@fsvc.cl."],
              { label: "Ir a Social", url: `${base}/p/${req.project.id}/social` },
            );
      await sendMail(user.email, status === "invited" ? `Acepta la invitación para conectar @${req.username}` : `Solicitud de Instagram @${req.username}`, m.text, undefined, m.html).catch((e) => console.error("[ig-access] aviso usuario", e));
    }
  }
  return req;
}

/** Al conectar una cuenta, su solicitud (si había) queda como conectada. */
export async function markIgRequestConnected(projectId: string, username: string) {
  await db.igAccessRequest.updateMany({ where: { projectId, username: username.toLowerCase(), status: { not: "connected" } }, data: { status: "connected" } });
}
