import Shell from "@/components/Shell";
import { pageProject } from "@/lib/session-server";

export const dynamic = "force-dynamic";

export default async function Layout({ children, params }: { children: React.ReactNode; params: { id: string } }) {
  await pageProject(params.id);
  return <Shell id={params.id}>{children}</Shell>;
}
