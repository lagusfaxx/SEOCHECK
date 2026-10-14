import type { Metadata } from "next";

export const metadata: Metadata = { title: "Nueva contraseña" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
