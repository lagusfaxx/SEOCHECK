import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/site/Header";
import { CONTACT_HREF, CtaAndFooter } from "@/components/site/Footer";
import { Kicker } from "@/components/site/Sections";

export const metadata: Metadata = {
  title: { absolute: "FSV Search — Plataforma de SEO técnico y search intelligence" },
  description: "Auditoría técnica, datos reales de Google Search Console, investigación de keywords, rankings y optimización de contenido en una sola plataforma. Hecha en Chile por Fullstack Ventures.",
  alternates: { canonical: "/search" },
  openGraph: { title: "FSV Search — SEO técnico y search intelligence", images: ["/brand/fsv-search-dashboard.png"] },
};

const MODULES: [string, string, string][] = [
  ["Auditoría técnica", "Recorre el sitio como Google y agrupa los problemas por causa y plantilla.", "Errores, redirecciones, títulos, canonicals, indexación y velocidad."],
  ["Search Console", "Clics, impresiones, CTR y posición reales por consulta y página.", "Consultas cerca de la primera página y CTR bajo para su posición."],
  ["Keywords", "Investigación a partir de pocas palabras, agrupada en clusters según lo que muestra Google.", "Cada cluster es una página a crear u optimizar."],
  ["Rankings", "Posición de tus keywords en el top 100 de Google.", "Alertas de caídas, canibalización y cambios de URL."],
  ["Contenido", "Compara tu página con el top 10 para una keyword y genera un brief.", "Términos, secciones y preguntas que te faltan."],
  ["Reporting", "Informes ejecutivos y técnicos con tareas ordenadas por prioridad.", "Listos para tu cliente o para tu equipo de desarrollo."],
];

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "FSV Search",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description: "Plataforma de SEO técnico y search intelligence: auditoría, Search Console, keywords, rankings, contenido y reporting.",
  url: "https://fsvc.cl/search",
  inLanguage: "es",
  publisher: { "@type": "Organization", name: "Full Stack Ventures SpA", url: "https://fsvc.cl" },
};

export default function SearchPage() {
  return (
    <>
      <Header />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <main>
        <section className="bg-white">
          <div className="mx-auto max-w-6xl px-4 pb-14 pt-14 md:px-6 md:pb-20 md:pt-24">
            <img src="/brand/fsv-search.png" alt="FSV Search" className="h-8 w-auto md:h-10" />
            <h1 className="mt-10 max-w-5xl font-display text-[2.5rem] font-semibold leading-[1] tracking-[-0.04em] md:text-[4.6rem]">
              SEO técnico y search intelligence.
              <br />
              <span className="text-fsv-muted">En una sola plataforma.</span>
            </h1>
            <div className="mt-10 grid gap-8 md:grid-cols-12">
              <p className="text-lg leading-relaxed text-fsv-ink/80 md:col-span-6">
                Auditoría técnica, datos reales de Google Search Console, keywords, rankings y contenido. FSV Search convierte esos datos en una lista de tareas ordenada por impacto.
              </p>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <a href={CONTACT_HREF} className="inline-flex items-center gap-2 rounded-sm bg-fsv-violet px-5 py-3 font-medium text-white transition hover:brightness-110">
                Solicitar acceso <span aria-hidden>→</span>
              </a>
              <a href="#modulos" className="font-medium underline decoration-fsv-violet decoration-2 underline-offset-[6px] transition hover:text-fsv-violet">
                Ver módulos
              </a>
            </div>
          </div>
        </section>

        <section className="border-y border-fsv-line bg-fsv-bg">
          <div className="mx-auto max-w-6xl px-4 py-10 md:px-6 md:py-16">
            <figure>
              <div className="overflow-hidden rounded-sm border border-fsv-line bg-white">
                <img src="/brand/fsv-search-dashboard.png" alt="Resumen de un proyecto en FSV Search: qué requiere atención, estado, Search Console y salud técnica" className="w-full" />
              </div>
              <figcaption className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-fsv-muted">Resumen de un proyecto · datos de demostración</figcaption>
            </figure>
          </div>
        </section>

        <section id="modulos" className="scroll-mt-16 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
            <Kicker>Módulos</Kicker>
            <ul className="mt-6 border-t border-fsv-ink">
              {MODULES.map(([t, d, x], i) => (
                <li key={t} className="grid gap-2 border-b border-fsv-line py-6 md:grid-cols-12 md:items-baseline md:gap-6 md:py-8">
                  <h2 className="font-display text-xl font-semibold tracking-tight md:col-span-4 md:text-2xl">
                    <span className="mr-3 font-mono text-sm font-normal text-fsv-muted">0{i + 1}</span>
                    {t}
                  </h2>
                  <p className="text-fsv-ink/80 md:col-span-5">{d}</p>
                  <p className="text-sm text-fsv-muted md:col-span-3">{x}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-t border-fsv-line bg-fsv-bg">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-16 md:grid-cols-12 md:px-6 md:py-20">
            <h2 className="font-display text-2xl font-semibold tracking-tight md:col-span-5 md:text-3xl">Hecha y usada por el equipo de Fullstack Ventures.</h2>
            <div className="md:col-span-6 md:col-start-7">
              <p className="leading-relaxed text-fsv-ink/80">La usamos para el SEO de nuestros propios negocios y la estamos abriendo a otras empresas. Si quieres probarla con tu sitio, escríbenos.</p>
              <Link href="/" className="mt-5 inline-block text-sm font-medium transition hover:text-fsv-violet">
                Conocer Fullstack Ventures <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </section>
      </main>
      <CtaAndFooter title="¿Quieres ver FSV Search con tu sitio?" text="Te mostramos la plataforma con tus propios datos." />
    </>
  );
}
