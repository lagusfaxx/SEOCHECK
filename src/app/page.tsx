import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import NewProject from "@/components/NewProject";

export const dynamic = "force-dynamic";

export default async function Home() {
  const p = await db.project.findFirst({ orderBy: { createdAt: "asc" } });
  if (p) redirect(`/p/${p.id}`);
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="card w-full max-w-md p-6">
        <NewProject />
      </div>
    </main>
  );
}
