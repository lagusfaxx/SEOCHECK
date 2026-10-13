import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/site/Header";
import { CtaAndFooter, CONTACT_EMAIL } from "@/components/site/Footer";
import { Kicker } from "@/components/site/Sections";

export const metadata: Metadata = {
  title: "Eliminación de datos",
  description: "Cómo eliminar los datos de Instagram y de tu cuenta en FSV Search.",
};

export default function EliminacionPage({ searchParams }: { searchParams: { codigo?: string } }) {
  const code = typeof searchParams.codigo === "string" && /^[a-f0-9]{16}$/.test(searchParams.codigo) ? searchParams.codigo : null;
  return (
    <>
      <Header />
      <main className="bg-white">
        <div className="mx-auto max-w-3xl px-4 pb-20 pt-14 md:px-6 md:pt-24">
          <Kicker>Legal</Kicker>
          <h1 className="mt-6 font-display text-[2.2rem] font-semibold leading-[1.05] tracking-[-0.03em] md:text-[3.2rem]">Eliminación de datos</h1>

          {code && (
            <div className="mt-10 border border-fsv-ink p-6">
              <div className="font-mono text-xs uppercase tracking-[0.18em] text-fsv-muted">Solicitud {code}</div>
              <p className="mt-3 text-lg font-medium">Completada: eliminamos el token de acceso y las estadísticas de Instagram asociadas a tu cuenta.</p>
            </div>
          )}

          <div className="mt-12 space-y-10 leading-relaxed text-fsv-ink/80 [&_a]:text-fsv-violet [&_a]:underline [&_li]:ml-5 [&_li]:list-decimal [&_ol]:space-y-2">
            <section className="border-t border-fsv-line pt-6">
              <h2 className="font-display text-xl font-semibold tracking-tight text-fsv-ink">Datos de Instagram</h2>
              <p className="mt-3">Cualquiera de estas opciones borra de inmediato el token de acceso y las estadísticas de tu cuenta de Instagram guardadas en FSV Search:</p>
              <ol className="mt-3">
                <li>En FSV Search: entra al proyecto → <b>Social</b> → <b>Desconectar</b>.</li>
                <li>En Instagram: <b>Configuración → Apps y sitios web</b> → elige la app y pulsa <b>Eliminar</b>. Meta nos avisa y borramos los datos automáticamente.</li>
                <li>Por correo a <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> indicando tu usuario de Instagram. Respondemos en un máximo de 30 días.</li>
              </ol>
            </section>
            <section className="border-t border-fsv-line pt-6">
              <h2 className="font-display text-xl font-semibold tracking-tight text-fsv-ink">Tu cuenta completa</h2>
              <p className="mt-3">
                Para eliminar tu cuenta de FSV Search y todos sus proyectos, escribe a <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> desde el correo de la cuenta. Más detalles en la{" "}
                <Link href="/privacidad">política de privacidad</Link>.
              </p>
            </section>
          </div>
        </div>
      </main>
      <CtaAndFooter />
    </>
  );
}
