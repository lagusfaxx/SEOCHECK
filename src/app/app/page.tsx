import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import NewProject from "@/components/NewProject";
import { AccountNotice } from "@/components/auth/AccountNotice";
import { userWorkspaceIds } from "@/lib/auth";
import { pageUser } from "@/lib/session-server";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const u = await pageUser();
  const p = await db.project.findFirst({ where: { workspaceId: { in: await userWorkspaceIds(u.id) } }, orderBy: { createdAt: "asc" } });
  // conserva avisos como ?verified=1 al entrar al proyecto
  const q = new URLSearchParams(Object.entries(searchParams).filter((e): e is [string, string] => typeof e[1] === "string" && ["verified", "verify_error"].includes(e[0])));
  if (p) redirect(`/p/${p.id}${q.size ? `?${q}` : ""}`);
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-md space-y-3">
        <AccountNotice />
        <div className="card p-6">
          <NewProject />
        </div>
      </div>
    </main>
  );
}
