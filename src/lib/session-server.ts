import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { db } from "./db";
import { requireProject, AuthError, SESSION_COOKIE, userFromToken } from "./auth";

/** Para server components: usuario de la sesión o redirección al login. */
export async function pageUser(next?: string) {
  const u = await userFromToken(cookies().get(SESSION_COOKIE)?.value);
  if (!u) redirect((await db.user.count()) === 0 ? "/setup" : `/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return u;
}

/** El proyecto tiene que ser de un workspace del usuario; si no, 404 (no se revela que existe). */
export async function pageProject(projectId: string) {
  const u = await pageUser(`/p/${projectId}`);
  try { await requireProject(u.id, projectId); } catch (e) { if (e instanceof AuthError) notFound(); throw e; }
  return u;
}
