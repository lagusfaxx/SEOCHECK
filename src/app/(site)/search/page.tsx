import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/site/Header";
import { CONTACT_HREF, CtaAndFooter } from "@/components/site/Footer";

export const metadata: Metadata = {
  title: "FSV Search — SEO Intelligence Platform",
  description: "Auditoría técnica, Search Console, keywords, rankings, contenido y reporting en una sola plataforma. Un producto de Fullstack Ventures.",
};

const MODULES = [
  ["Auditoría", "Recorre el sitio como Google y agrupa los problemas por causa y plantilla."],
  ["Search Console", "Clics, impresiones, CTR y posición reales por consulta y página."],
  ["Keywords", "Investigación agrupada en clusters según lo que Google muestra."],
  ["Rankings", "Posición de tus keywords con alertas de caídas y canibalización."],
  ["Contenido", "Compara tu página con el top 10 y genera un brief accionable."],
  ["Reporting", "Informes ejecutivos y técnicos con tareas ordenadas por prioridad."],
];

/** Página del producto. Versión inicial: la landing completa de FSV Search viene después. */
export default function SearchPage() {
  return (
    <>
      <Header />
      <main>
        <section className="border-b border-fsv-line bg-fsv-bg">
          <div className="mx-auto max-w-6xl px-4 pb-20 pt-16 md:px-6 md:pt-24">
            <img src="/brand/fsv-search.png" alt="FSV Search" className="h-10 w-auto md:h-12" />
            <h1 className="mt-10 max-w-3xl font-display text-[2.4rem] font-semibold leading-[1.04] tracking-[-0.035em] md:text-6xl">Search intelligence para convertir datos SEO en decisiones.</h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-fsv-muted">Un producto de Fullstack Ventures. Estamos preparando el acceso: escríbenos si quieres probarlo con tu sitio.</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <a href={CONTACT_HREF} className="inline-flex items-center gap-2 rounded-lg bg-fsv-violet px-5 py-3 font-medium text-white transition hover:brightness-110">
                Solicitar acceso <span aria-hidden>→</span>
              </a>
              <Link href="/" className="rounded-lg border border-fsv-ink/15 bg-white px-5 py-3 font-medium transition hover:border-fsv-ink/40">
                Fullstack Ventures
              </Link>
            </div>
            <div className="mt-14 overflow-hidden rounded-xl border border-fsv-line bg-white shadow-[0_24px_48px_-24px_rgba(17,19,24,0.25)]">
              <img src="/brand/fsv-search-dashboard.png" alt="Dashboard de FSV Search" className="w-full" />
            </div>
          </div>
        </section>
        <section className="bg-white">
          <ul className="mx-auto grid max-w-6xl gap-px px-4 py-20 sm:grid-cols-2 md:px-6 lg:grid-cols-3">
            {MODULES.map(([t, d]) => (
              <li key={t} className="border-t border-fsv-line py-6 pr-8">
                <div className="font-mono text-xs uppercase tracking-[0.18em] text-fsv-violet">{t}</div>
                <p className="mt-3 leading-relaxed text-fsv-muted">{d}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <CtaAndFooter title="¿Quieres ver FSV Search con tu sitio?" text="Te mostramos la plataforma con tus propios datos." />
    </>
  );
}
