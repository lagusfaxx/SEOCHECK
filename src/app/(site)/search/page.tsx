import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/site/Header";
import { CtaAndFooter } from "@/components/site/Footer";
import { PLANS, planPriceClp, TRIAL_DAYS } from "@/lib/plans";

export const revalidate = 3600;

const PRICE = () => planPriceClp().toLocaleString("es-CL");

export function generateMetadata(): Metadata {
  const title = "FSV Search — Herramienta SEO con datos reales de Google";
  const description = `Auditoría SEO técnica, Search Console, investigación de keywords, rankings, briefs de contenido con IA y publicación en Instagram. Desde $${PRICE()} al mes por perfil, con ${TRIAL_DAYS} días gratis. Hecha en Chile.`;
  return {
    title: { absolute: title },
    description,
    keywords: ["herramienta SEO", "auditoría SEO", "software SEO Chile", "Search Console", "investigación de keywords", "seguimiento de rankings", "SEO en español"],
    alternates: { canonical: "/search" },
    openGraph: { type: "website", url: "/search", title, description, images: [{ url: "/brand/fsv-search-dashboard.png", alt: "Resumen de un proyecto en FSV Search" }] },
    twitter: { card: "summary_large_image", title, description, images: ["/brand/fsv-search-dashboard.png"] },
  };
}

/** Tres bloques orientados a resultados, cada uno con una captura real del producto (datos de demostración). */
const BLOCKS: { n: string; title: string; sub: string; img: string; alt: string }[] = [
  { n: "01", title: "Encuentra qué está frenando tu sitio.", sub: "Auditoría técnica, indexación y datos de Search Console.", img: "/brand/search-audit.png", alt: "Auditoría técnica en FSV Search: salud técnica, errores y páginas revisadas" },
  { n: "02", title: "Descubre dónde crecer.", sub: "Keywords, clusters, rankings y análisis competitivo.", img: "/brand/search-keywords.png", alt: "Investigación de keywords en FSV Search: intención, volumen y dificultad" },
  { n: "03", title: "Convierte datos en acciones.", sub: "Contenido, briefs e informes priorizados.", img: "/brand/search-content.png", alt: "Análisis de contenido en FSV Search: puntaje, términos faltantes y brief" },
];

const FEATURES: [string, string][] = [
  ["Auditoría SEO técnica", "Revisa tu sitio página por página: errores, indexación, velocidad, enlaces y datos estructurados, ordenados por impacto."],
  ["Google Search Console", "Conecta tu cuenta con un clic: clics, impresiones, posición y oportunidades por página, sincronizados todos los días."],
  ["Investigación de keywords", "Encuentra búsquedas reales con volumen, intención y dificultad, agrupadas en clusters y temas."],
  ["Seguimiento de rankings", "Mide tu posición en Google para las keywords que importan y recibe alertas cuando algo cambia."],
  ["Briefs de contenido con IA", "Compara tu página con el top 10 y recibe un brief con lo que falta: términos, secciones y preguntas."],
  ["Instagram con IA", "Genera imágenes y textos para tu marca, publica o programa en Instagram y mide qué funciona."],
  ["Informes y tareas", "Informes en PDF para tu equipo o clientes y una lista de tareas priorizada, explicada en simple."],
];

const FAQ = (): [string, string][] => {
  const p = PLANS.pro;
  return [
    ["¿Cuánto cuesta FSV Search?", `$${PRICE()} al mes por perfil. Un perfil es un sitio o marca: si administras tres sitios, contratas tres perfiles. Puedes sumar o quitar perfiles cuando quieras.`],
    ["¿Cómo funciona la prueba gratis?", `Al crear tu cuenta tienes ${TRIAL_DAYS} días gratis, sin tarjeta, con un cupo reducido para probar cada herramienta. Al terminar, tus datos quedan guardados hasta que actives el plan.`],
    ["¿Cómo se paga?", "Con Mercado Pago, usando tarjeta de crédito o débito. La suscripción se cobra automáticamente cada mes y puedes cancelarla cuando quieras desde la app; el plan sigue hasta el fin del periodo pagado."],
    ["¿Qué incluye cada perfil?", `Cada mes: ${p.research} investigaciones de keywords, ${p.briefs} briefs de contenido, ${p.reports} informes, ${p.images} imágenes y ${p.ai} textos con IA, ${p.rankings} keywords en seguimiento y auditorías de hasta ${p.urls.toLocaleString("es-CL")} páginas.`],
    ["¿Necesito Google Search Console?", "No es obligatorio, pero lo recomendamos: con Search Console ves los clics e impresiones reales de tu sitio. Se conecta con tu cuenta de Google en un clic."],
    ["¿Qué pasa si llego al límite del mes?", "La herramienta te avisa y el cupo se renueva el mes siguiente. Si necesitas más, suma otro perfil o escríbenos."],
  ];
};

const jsonLd = () => ({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "FSV Search",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "SEO",
      operatingSystem: "Web",
      description: "Herramienta SEO con datos reales de Google: auditoría técnica, Search Console, keywords, rankings, briefs de contenido con IA, Instagram e informes.",
      url: "https://fsvc.cl/search",
      image: "https://fsvc.cl/brand/fsv-search-dashboard.png",
      inLanguage: "es",
      featureList: FEATURES.map(([t]) => t),
      offers: { "@type": "Offer", price: planPriceClp(), priceCurrency: "CLP", url: "https://fsvc.cl/search#precios", availability: "https://schema.org/InStock", description: `Por perfil al mes, con ${TRIAL_DAYS} días de prueba gratis` },
      publisher: { "@type": "Organization", name: "Full Stack Ventures SpA", url: "https://fsvc.cl" },
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQ().map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Fullstack Ventures", item: "https://fsvc.cl/" },
        { "@type": "ListItem", position: 2, name: "FSV Search", item: "https://fsvc.cl/search" },
      ],
    },
  ],
});

export default function SearchPage() {
  return (
    <>
      <Header />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd()).replace(/</g, "\\u003c") }} />
      <main>
        <section className="bg-white">
          <div className="mx-auto max-w-6xl px-4 pb-14 pt-14 md:px-6 md:pb-20 md:pt-24">
            <img src="/brand/fsv-search.png" alt="FSV Search" className="h-8 w-auto md:h-10" />
            <h1 className="mt-10 max-w-5xl font-display text-[2.5rem] font-semibold leading-[1] tracking-[-0.04em] md:text-[4.6rem]">
              La herramienta SEO con datos reales de Google.
              <br />
              <span className="text-fsv-muted">En una sola plataforma.</span>
            </h1>
            <p className="mt-8 max-w-xl text-lg leading-relaxed text-fsv-ink/80">Auditoría técnica, Search Console, keywords, rankings, contenido e Instagram: convierte tus datos en una lista de tareas ordenada por impacto.</p>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link href="/signup" className="inline-flex items-center gap-2 rounded-sm bg-fsv-violet px-5 py-3 font-medium text-white transition hover:brightness-110">
                Probar {TRIAL_DAYS} días gratis <span aria-hidden>→</span>
              </Link>
              <a href="#precios" className="font-medium underline decoration-fsv-violet decoration-2 underline-offset-[6px] transition hover:text-fsv-violet">
                Ver precios
              </a>
              <Link href="/login" className="text-sm text-fsv-muted transition hover:text-fsv-ink">
                ¿Ya tienes cuenta? Entrar
              </Link>
            </div>
            <p className="mt-4 text-sm text-fsv-muted">Sin tarjeta para la prueba · Desde ${PRICE()} al mes por perfil</p>
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

        <section aria-labelledby="funciones" className="border-t border-fsv-line bg-fsv-bg">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
            <h2 id="funciones" className="font-display text-[1.9rem] font-semibold leading-tight tracking-[-0.03em] md:text-5xl">Todo lo que necesitas para crecer en Google.</h2>
            <div className="mt-10 grid gap-px overflow-hidden rounded-sm border border-fsv-line bg-fsv-line sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(([t, d]) => (
                <div key={t} className="bg-white p-6">
                  <h3 className="font-display text-lg font-semibold tracking-tight">{t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-fsv-muted">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="precios" aria-labelledby="precios-t" className="scroll-mt-16 border-t border-fsv-line bg-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:px-6 md:py-24 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-fsv-violet">Precios</div>
              <h2 id="precios-t" className="mt-4 font-display text-[1.9rem] font-semibold leading-tight tracking-[-0.03em] md:text-5xl">Un precio simple, por perfil.</h2>
              <p className="mt-4 text-fsv-muted">Un perfil es un sitio o marca. Paga solo por los que administras y suma o quita perfiles cuando quieras.</p>
            </div>
            <div className="rounded-sm border border-fsv-line p-6 md:p-8 lg:col-span-7">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-display text-5xl font-semibold tracking-tight">${PRICE()}</span>
                <span className="text-fsv-muted">CLP al mes por perfil</span>
              </div>
              <p className="mt-2 text-sm text-fsv-muted">{TRIAL_DAYS} días gratis sin tarjeta · Pago mensual con Mercado Pago · Cancela cuando quieras</p>
              <ul className="mt-6 grid gap-2 text-sm sm:grid-cols-2">
                {[
                  `${PLANS.pro.research} investigaciones de keywords al mes`,
                  `${PLANS.pro.briefs} briefs de contenido al mes`,
                  `${PLANS.pro.reports} informes al mes`,
                  `${PLANS.pro.images} imágenes con IA al mes`,
                  `${PLANS.pro.ai} textos con IA al mes`,
                  `${PLANS.pro.rankings} keywords en seguimiento`,
                  `Auditorías de hasta ${PLANS.pro.urls.toLocaleString("es-CL")} páginas`,
                  "Search Console e Instagram conectados",
                ].map((t) => (
                  <li key={t} className="flex gap-2"><span aria-hidden className="text-fsv-violet">✓</span>{t}</li>
                ))}
              </ul>
              <Link href="/signup" className="mt-8 inline-flex items-center gap-2 rounded-sm bg-fsv-violet px-5 py-3 font-medium text-white transition hover:brightness-110">
                Empezar prueba gratis <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </section>

        <section aria-labelledby="faq" className="border-t border-fsv-line bg-fsv-bg">
          <div className="mx-auto max-w-3xl px-4 py-16 md:px-6 md:py-24">
            <h2 id="faq" className="font-display text-[1.9rem] font-semibold leading-tight tracking-[-0.03em] md:text-4xl">Preguntas frecuentes</h2>
            <div className="mt-8 divide-y divide-fsv-line border-y border-fsv-line">
              {FAQ().map(([q, a]) => (
                <details key={q} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                    <h3>{q}</h3>
                    <span aria-hidden className="text-fsv-violet transition group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-fsv-muted">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-fsv-line bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-baseline justify-between gap-4 px-4 py-10 md:px-6 md:py-12">
            <p className="font-display text-xl font-semibold tracking-tight md:text-2xl">Hecha y usada por el equipo de Fullstack Ventures.</p>
            <Link href="/" className="text-sm font-medium transition hover:text-fsv-violet">
              Conocer FSV <span aria-hidden>→</span>
            </Link>
          </div>
        </section>
      </main>
      <CtaAndFooter title="Prueba FSV Search con tu sitio." cta={`Empezar ${TRIAL_DAYS} días gratis`} href="/signup" note={`Luego $${PRICE()} al mes por perfil`} />
    </>
  );
}
