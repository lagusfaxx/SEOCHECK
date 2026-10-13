import { notFound } from "next/navigation";
import { isInstanceAdmin } from "@/lib/auth";
import { pageUser } from "@/lib/session-server";
import { AdminPanel } from "@/components/admin/AdminPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Administración · FSV Search" };

export default async function AdminPage() {
  const u = await pageUser("/admin");
  if (!(await isInstanceAdmin(u.id))) notFound();
  return <AdminPanel me={u.id} />;
}
