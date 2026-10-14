import type { Metadata } from "next";
import Shell from "@/components/Shell";
import { db } from "@/lib/db";
import { pageProject } from "@/lib/session-server";

export const dynamic = "force-dynamic";

/** La pestaña muestra el dominio del proyecto (solo después de comprobar el acceso). */
export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  await pageProject(params.id);
  const p = await db.project.findUnique({ where: { id: params.id }, select: { domain: true } });
  return { title: p?.domain ?? "Proyecto" };
}

export default async function Layout({ children, params }: { children: React.ReactNode; params: { id: string } }) {
  await pageProject(params.id);
  return <Shell id={params.id}>{children}</Shell>;
}
