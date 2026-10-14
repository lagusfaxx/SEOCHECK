import "./globals.css";
import type { Metadata } from "next";

/** La app no se indexa; el sitio público ((site)/layout) pone su propio título e indexación. Íconos: app/icon.png, apple-icon.png y favicon.ico. */
export const metadata: Metadata = { title: { default: "FSV Search", template: "%s · FSV Search" }, applicationName: "FSV Search", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
