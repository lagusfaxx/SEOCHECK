import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Header } from "@/components/site/Header";
import { CtaAndFooter } from "@/components/site/Footer";
import { Breadcrumbs, breadcrumbLd, FeatureLinks, GuideLinks, JsonLd, price, SITE_URL, TrialButtons } from "@/components/site/SearchKit";
import { FEATURE_PAGES, featureBySlug } from "@/lib/search-marketing";
import { planPriceClp, TRIAL_DAYS } from "@/lib/plans";

export const dynamicParams = false;
export const revalidate = 3600;
export const generateStaticParams = () => FEATURE_PAGES.map((f) => ({ slug: f.slug }));

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const f = featureBySlug(params.slug);
  if (!f) return {};
  const path = `/search/${f.slug}`;
  return {
    title: { absolute: f.title },
    description: f.description,
    alternates: { canonical: path },
    openGraph: { type: "website", url: path, title: f.title, description: f.description, images: [{ url: f.img?.src ?? "/brand/fsv-search-dashboard.png" }] },
    twitter: { card: "summary_large_image", title: f.title, description: f.description },
  };
}

/** Página de una función de FSV Search: posiciona su búsqueda propia ("auditoría SEO", "seguimiento de rankings"…). */
export default function FeaturePage({ params }: { params: { slug: string } }) {
  const f = featureBySlug(params.slug);
  if (!f) notFound();
  const crumbs: [string, string][] = [["FSV", "/"], ["FSV Search", "/search"], [f.name, `/search/${f.slug}`]];
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: f.title,
        description: f.description,
        url: `${SITE_URL}/search/${f.slug}`,
        inLanguage: "es",
        about: { "@type": "SoftwareApplication", name: "FSV Search", applicationCategory: "BusinessApplication", operatingSystem: "Web", offers: { "@type": "Offer", price: planPriceClp(), priceCurrency: "CLP" } },
      },
      { "@type": "HowTo", name: f.h1, step: f.steps.map(([name, text], i) => ({ "@type": "HowToStep", position: i + 1, name, text })) },
      { "@type": "FAQPage", mainEntity: f.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
      breadcrumbLd(crumbs),
    ],
  };
  return (
    <>
      <Header />
      <JsonLd data={ld} />
      <main>
        <section className="bg-white">
          <div className="mx-auto max-w-6xl px-4 pb-12 pt-10 md:px-6 md:pb-16 md:pt-16">
            <Breadcrumbs items={crumbs} />
            <h1 className="mt-8 max-w-4xl font-display text-[2.3rem] font-semibold leading-[1.02] tracking-[-0.035em] md:text-[3.8rem]">{f.h1}</h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-fsv-ink/80">{f.lead}</p>
            <div className="mt-8">
              <TrialButtons />
            </div>
            <p className="mt-4 text-sm text-fsv-muted">{TRIAL_DAYS} días gratis sin tarjeta · Desde ${price()} al mes por perfil</p>
          </div>
        </section>

        {f.img && (
          <section className="border-y border-fsv-line bg-fsv-bg">
            <div className="mx-auto max-w-6xl px-4 py-10 md:px-6 md:py-14">
              <div className="overflow-hidden rounded-sm border border-fsv-line bg-white">
                <img src={f.img.src} alt={f.img.alt} className="w-full" loading="lazy" />
              </div>
              <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-fsv-muted">Captura real del producto · datos de demostración</p>
            </div>
          </section>
        )}

        <section className="bg-white">
          <div className="mx-auto max-w-6xl px-4 py-14 md:px-6 md:py-20">
            <h2 className="font-display text-2xl font-semibold tracking-tight md:text-4xl">Cómo funciona</h2>
            <ol className="mt-8 grid gap-6 md:grid-cols-3">
              {f.steps.map(([name, text], i) => (
                <li key={name} className="border-t border-fsv-ink pt-4">
                  <div className="font-mono text-sm text-fsv-violet">0{i + 1}</div>
                  <h3 className="mt-2 font-display text-lg font-semibold tracking-tight">{name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-fsv-muted">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-t border-fsv-line bg-fsv-bg">
          <div className="mx-auto max-w-3xl space-y-12 px-4 py-14 md:px-6 md:py-20">
            {f.sections.map((s) => (
              <div key={s.h2}>
                <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">{s.h2}</h2>
                {s.p?.map((t) => <p key={t} className="mt-4 leading-relaxed text-fsv-ink/80">{t}</p>)}
                {s.list && (
                  <ul className="mt-4 space-y-2">
                    {s.list.map((t) => (
                      <li key={t} className="flex gap-2 leading-relaxed text-fsv-ink/80"><span aria-hidden className="text-fsv-violet">✓</span>{t}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white">
          <div className="mx-auto max-w-3xl px-4 py-14 md:px-6 md:py-20">
            <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">Preguntas frecuentes</h2>
            <div className="mt-6 divide-y divide-fsv-line border-y border-fsv-line">
              {f.faq.map(([q, a]) => (
                <details key={q} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                    <h3>{q}</h3>
                    <span aria-hidden className="text-fsv-violet transition group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-fsv-muted">{a}</p>
                </details>
              ))}
            </div>
            {f.guides.length > 0 && (
              <>
                <h2 className="mt-14 font-display text-xl font-semibold tracking-tight">Guías relacionadas</h2>
                <div className="mt-4">
                  <GuideLinks only={f.guides} />
                </div>
              </>
            )}
          </div>
        </section>

        <section className="border-t border-fsv-line bg-fsv-bg">
          <div className="mx-auto max-w-6xl px-4 py-14 md:px-6 md:py-16">
            <h2 className="font-display text-xl font-semibold tracking-tight">Todo en una sola plataforma</h2>
            <div className="mt-6">
              <FeatureLinks exclude={f.slug} />
            </div>
          </div>
        </section>
      </main>
      <CtaAndFooter title="Prueba FSV Search con tu sitio." cta={`Probar ${TRIAL_DAYS} días gratis`} href="/signup" note={`Luego $${price()} al mes por perfil`} />
    </>
  );
}
