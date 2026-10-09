import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/site/Header";
import { CONTACT_HREF, CtaAndFooter } from "@/components/site/Footer";

export const metadata: Metadata = {
  title: { absolute: "FSV Search — Plataforma de SEO técnico y search intelligence" },
  description: "Auditoría técnica, datos reales de Google Search Console, investigación de keywords, rankings y optimización de contenido en una sola plataforma. Hecha en Chile por Fullstack Ventures.",
  alternates: { canonical: "/search" },
  openGraph: { title: "FSV Search — SEO técnico y search intelligence", images: ["/brand/fsv-search-dashboard.png"] },
};

/** Tres bloques orientados a resultados, cada uno con una captura real del producto (datos de demostración). */
const BLOCKS: { n: string; title: string; sub: string; img: string; alt: string }[] = [
  { n: "01", title: "Encuentra qué está frenando tu sitio.", sub: "Auditoría técnica, indexación y datos de Search Console.", img: "/brand/search-audit.png", alt: "Auditoría técnica en FSV Search: salud técnica, errores y páginas revisadas" },
  { n: "02", title: "Descubre dónde crecer.", sub: "Keywords, clusters, rankings y análisis competitivo.", img: "/brand/search-keywords.png", alt: "Investigación de keywords en FSV Search: intención, volumen y dificultad" },
  { n: "03", title: "Convierte datos en acciones.", sub: "Contenido, briefs e informes priorizados.", img: "/brand/search-content.png", alt: "Análisis de contenido en FSV Search: puntaje, términos faltantes y brief" },
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
            <p className="mt-8 max-w-xl text-lg leading-relaxed text-fsv-ink/80">Convierte tus datos de Google en una lista de tareas ordenada por impacto.</p>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <a href={CONTACT_HREF} className="inline-flex items-center gap-2 rounded-sm bg-fsv-violet px-5 py-3 font-medium text-white transition hover:brightness-110">
                Solicitar acceso <span aria-hidden>→</span>
              </a>
              <a href="#producto" className="font-medium underline decoration-fsv-violet decoration-2 underline-offset-[6px] transition hover:text-fsv-violet">
                Ver el producto
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
              <figcaption className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-fsv-muted">Capturas reales del producto · datos de demostración</figcaption>
            </figure>
          </div>
        </section>

        <section id="producto" className="scroll-mt-16 bg-white">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            {BLOCKS.map((b) => (
              <article key={b.n} className="border-t border-fsv-line py-16 first:border-t-0 md:py-28">
                <div className="grid gap-4 md:grid-cols-12 md:items-baseline md:gap-6">
                  <div className="font-mono text-sm text-fsv-violet md:col-span-1">{b.n}</div>
                  <h2 className="font-display text-[1.9rem] font-semibold leading-tight tracking-[-0.03em] md:col-span-7 md:text-5xl">{b.title}</h2>
                  <p className="text-fsv-muted md:col-span-4 md:text-lg">{b.sub}</p>
                </div>
                <div className="mt-8 overflow-hidden rounded-sm border border-fsv-line bg-fsv-bg md:mt-12">
                  <img src={b.img} alt={b.alt} className="w-full" loading="lazy" />
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="border-t border-fsv-line bg-fsv-bg">
          <div className="mx-auto flex max-w-6xl flex-wrap items-baseline justify-between gap-4 px-4 py-10 md:px-6 md:py-12">
            <p className="font-display text-xl font-semibold tracking-tight md:text-2xl">Hecha y usada por el equipo de Fullstack Ventures.</p>
            <Link href="/" className="text-sm font-medium transition hover:text-fsv-violet">
              Conocer FSV <span aria-hidden>→</span>
            </Link>
          </div>
        </section>
      </main>
      <CtaAndFooter title="¿Quieres ver FSV Search con tu sitio?" cta="Solicitar acceso" />
    </>
  );
}
