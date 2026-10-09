import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://fsvc.cl"),
  title: { default: "Fullstack Ventures — Software, seguridad y crecimiento digital", template: "%s · Fullstack Ventures" },
  description: "Construimos, protegemos y hacemos crecer productos digitales. Software a medida, ciberseguridad y productos tecnológicos propios. Santiago, Chile.",
  robots: { index: true, follow: true },
  icons: { icon: "/brand/fsv-mark.png" },
  openGraph: { type: "website", locale: "es_CL", siteName: "Fullstack Ventures", images: ["/brand/fsv-fullstack-ventures.png"] },
};

/** Sitio público de Fullstack Ventures: siempre claro, con su propia tipografía. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" />
      <div className="min-h-screen bg-white font-sans text-fsv-ink antialiased [color-scheme:light]">{children}</div>
    </>
  );
}
