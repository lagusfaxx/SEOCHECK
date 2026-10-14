import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/site/Header";
import { CtaAndFooter } from "@/components/site/Footer";
import { Breadcrumbs, breadcrumbLd, JsonLd, price, SITE_URL } from "@/components/site/SearchKit";
import { GUIDES } from "@/lib/search-marketing";
import { TRIAL_DAYS } from "@/lib/plans";

export const metadata: Metadata = {
  title: { absolute: "Guías de SEO en español — FSV Search" },
  description: "Guías prácticas de SEO: auditoría técnica, Google Search Console, keywords, títulos y SEO para tiendas online. Escritas por el equipo de FSV.",
  alternates: { canonical: "/search/guias" },
  openGraph: { type: "website", url: "/search/guias", title: "Guías de SEO en español — FSV Search", images: ["/brand/fsv-search-dashboard.png"] },
};

export default function GuidesIndex() {
  const crumbs: [string, string][] = [["FSV", "/"], ["FSV Search", "/search"], ["Guías", "/search/guias"]];
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "CollectionPage", name: "Guías de SEO", url: `${SITE_URL}/search/guias`, inLanguage: "es", hasPart: GUIDES.map((g) => ({ "@type": "Article", headline: g.title, url: `${SITE_URL}/search/guias/${g.slug}` })) },
      breadcrumbLd(crumbs),
    ],
  };
  return (
    <>
      <Header />
      <JsonLd data={ld} />
      <main className="bg-white">
        <div className="mx-auto max-w-4xl px-4 pb-20 pt-10 md:px-6 md:pt-16">
          <Breadcrumbs items={crumbs} />
          <h1 className="mt-8 font-display text-[2.3rem] font-semibold leading-[1.02] tracking-[-0.035em] md:text-[3.6rem]">Guías de SEO</h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-fsv-ink/80">Lo esencial para posicionar tu sitio en Google, explicado en simple y en orden.</p>
          <ul className="mt-12 grid gap-px overflow-hidden rounded-sm border border-fsv-line bg-fsv-line sm:grid-cols-2">
            {GUIDES.map((g) => (
              <li key={g.slug} className="bg-white">
                <Link href={`/search/guias/${g.slug}`} className="group block h-full p-6 transition hover:bg-fsv-bg">
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-fsv-muted">{g.minutes} min de lectura</div>
                  <h2 className="mt-2 font-display text-xl font-semibold leading-snug tracking-tight transition group-hover:text-fsv-violet">{g.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-fsv-muted">{g.description}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
      <CtaAndFooter title="Aplica estas guías con datos de tu sitio." cta={`Probar ${TRIAL_DAYS} días gratis`} href="/signup" note={`Luego $${price()} al mes por perfil`} />
    </>
  );
}
