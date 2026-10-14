import type { Metadata } from "next";
import { Header } from "@/components/site/Header";
import { CtaAndFooter } from "@/components/site/Footer";
import { Breadcrumbs, breadcrumbLd, FeatureLinks, JsonLd, price, SITE_URL } from "@/components/site/SearchKit";
import { FreeAuditForm } from "@/components/site/FreeAuditForm";
import { TRIAL_DAYS } from "@/lib/plans";

const TITLE = "Auditoría SEO gratis de tu página — FSV Search";
const DESC = "Analiza gratis el SEO de cualquier página en segundos: título, meta descripción, H1, contenido, indexación, canonical, datos estructurados, robots.txt y sitemap. Sin registro.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESC,
  alternates: { canonical: "/search/auditoria-gratis" },
  openGraph: { type: "website", url: "/search/auditoria-gratis", title: TITLE, description: DESC, images: ["/brand/search-audit.png"] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC },
};

/** Herramienta gratis sin registro: el imán de clientes de FSV Search. */
export default function FreeAuditPage() {
  const crumbs: [string, string][] = [["FSV", "/"], ["FSV Search", "/search"], ["Auditoría SEO gratis", "/search/auditoria-gratis"]];
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebApplication", name: "Auditoría SEO gratis — FSV Search", url: `${SITE_URL}/search/auditoria-gratis`, applicationCategory: "BusinessApplication", operatingSystem: "Web", inLanguage: "es", offers: { "@type": "Offer", price: 0, priceCurrency: "CLP" }, description: DESC },
      breadcrumbLd(crumbs),
    ],
  };
  return (
    <>
      <Header />
      <JsonLd data={ld} />
      <main>
        <section className="bg-white">
          <div className="mx-auto max-w-4xl px-4 pb-14 pt-10 md:px-6 md:pt-16">
            <Breadcrumbs items={crumbs} />
            <h1 className="mt-8 font-display text-[2.3rem] font-semibold leading-[1.02] tracking-[-0.035em] md:text-[3.6rem]">Auditoría SEO gratis de tu página</h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-fsv-ink/80">Escribe la dirección de tu sitio y revisamos en segundos los puntos básicos que Google mira en esa página. Sin registro.</p>
            <div className="mt-10">
              <FreeAuditForm trialDays={TRIAL_DAYS} price={price()} />
            </div>
          </div>
        </section>
        <section className="border-t border-fsv-line bg-fsv-bg">
          <div className="mx-auto max-w-6xl px-4 py-14 md:px-6 md:py-16">
            <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">¿Y el resto del sitio?</h2>
            <p className="mt-3 max-w-2xl text-fsv-muted">Esta revisión mira una sola página. Con FSV Search auditas el sitio completo y lo cruzas con tus datos reales de Google.</p>
            <div className="mt-8">
              <FeatureLinks />
            </div>
          </div>
        </section>
      </main>
      <CtaAndFooter title="Audita tu sitio completo." cta={`Probar ${TRIAL_DAYS} días gratis`} href="/signup" note={`Luego $${price()} al mes por perfil`} />
    </>
  );
}
