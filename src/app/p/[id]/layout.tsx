import Shell from "@/components/Shell";

export default function Layout({ children, params }: { children: React.ReactNode; params: { id: string } }) {
  return <Shell id={params.id}>{children}</Shell>;
}
