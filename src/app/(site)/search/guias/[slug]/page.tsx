import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/site/Header";
import { CtaAndFooter } from "@/components/site/Footer";
import { Breadcrumbs, breadcrumbLd, GuideLinks, JsonLd, price, SITE_URL, TrialButtons } from "@/components/site/SearchKit";
import { GUIDES, featureBySlug, guideBySlug } from "@/lib/search-marketing";
import { TRIAL_DAYS } from "@/lib/plans";

export const dynamicParams = false;
export const generateStaticParams = () => GUIDES.map((g) => ({ slug: g.slug }));

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const g = guideBySlug(params.slug);
  if (!g) return {};
  const path = `/search/guias/${g.slug}`;
  return {
    title: { absolute: `${g.title} — FSV Search` },
    description: g.description,
    alternates: { canonical: path },
    openGraph: { type: "article", url: path, title: g.title, description: g.description, publishedTime: g.date, images: ["/brand/fsv-search-dashboard.png"] },
    twitter: { card: "summary_large_image", title: g.title, description: g.description },
  };
}

/** Guía de SEO: contenido útil que atrae búsquedas informativas y lleva a la función relacionada. */
export default function GuidePage({ params }: { params: { slug: string } }) {
  const g = guideBySlug(params.slug);
  if (!g) notFound();
  const feature = featureBySlug(g.feature);
  const crumbs: [string, string][] = [["FSV", "/"], ["FSV Search", "/search"], ["Guías", "/search/guias"], [g.title, `/search/guias/${g.slug}`]];
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: g.title,
        description: g.description,
        datePublished: g.date,
        dateModified: g.date,
        inLanguage: "es",
        url: `${SITE_URL}/search/guias/${g.slug}`,
        author: { "@type": "Organization", name: "FSV", url: SITE_URL },
        publisher: { "@type": "Organization", name: "FSV", url: SITE_URL, logo: { "@type": "ImageObject", url: `${SITE_URL}/brand/fsv-mark.png` } },
        image: `${SITE_URL}/brand/fsv-search-dashboard.png`,
      },
      breadcrumbLd(crumbs),
    ],
  };
  return (
    <>
      <Header />
      <JsonLd data={ld} />
      <main className="bg-white">
        <article className="mx-auto max-w-3xl px-4 pb-16 pt-10 md:px-6 md:pt-16">
          <Breadcrumbs items={crumbs.slice(0, 3)} />
          <h1 className="mt-8 font-display text-[2.1rem] font-semibold leading-[1.05] tracking-[-0.03em] md:text-[3.2rem]">{g.h1}</h1>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-fsv-muted">
            Equipo FSV · <time dateTime={g.date}>{new Date(g.date + "T12:00:00").toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" })}</time> · {g.minutes} min de lectura
          </p>
          <p className="mt-8 text-lg leading-relaxed text-fsv-ink/80">{g.intro}</p>
          {g.sections.map((s) => (
            <section key={s.h2} className="mt-10">
              <h2 className="font-display text-2xl font-semibold tracking-tight">{s.h2}</h2>
              {s.p?.map((t) => <p key={t} className="mt-4 leading-relaxed text-fsv-ink/80">{t}</p>)}
              {s.list && (
                <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed text-fsv-ink/80 marker:text-fsv-violet">
                  {s.list.map((t) => <li key={t}>{t}</li>)}
                </ul>
              )}
            </section>
          ))}
          {feature && (
            <aside className="mt-14 rounded-sm border border-fsv-line bg-fsv-bg p-6">
              <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-fsv-violet">Hazlo con FSV Search</div>
              <p className="mt-3 font-display text-xl font-semibold tracking-tight">{feature.h1}</p>
              <p className="mt-2 text-sm leading-relaxed text-fsv-muted">{feature.lead}</p>
              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
                <TrialButtons />
                <Link href={`/search/${feature.slug}`} className="text-sm text-fsv-muted transition hover:text-fsv-ink">Ver {feature.name.toLowerCase()} →</Link>
              </div>
            </aside>
          )}
          <h2 className="mt-14 font-display text-xl font-semibold tracking-tight">Otras guías</h2>
          <div className="mt-4">
            <GuideLinks exclude={g.slug} />
          </div>
        </article>
      </main>
      <CtaAndFooter title="Prueba FSV Search con tu sitio." cta={`Probar ${TRIAL_DAYS} días gratis`} href="/signup" note={`Luego $${price()} al mes por perfil`} />
    </>
  );
}
