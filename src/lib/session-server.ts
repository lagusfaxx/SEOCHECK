import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { db } from "./db";
import { projectRole, SESSION_COOKIE, userFromToken } from "./auth";

/** Para server components: usuario de la sesión o redirección al login. */
export async function pageUser(next?: string) {
  const u = await userFromToken(cookies().get(SESSION_COOKIE)?.value);
  if (!u) redirect((await db.user.count()) === 0 ? "/setup" : `/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return u;
}

/** El proyecto tiene que ser de un workspace del usuario; si no, 404 (no se revela que existe). */
export async function pageProject(projectId: string) {
  const u = await pageUser(`/p/${projectId}`);
  if (!(await projectRole(u.id, projectId))) notFound();
  return u;
}
