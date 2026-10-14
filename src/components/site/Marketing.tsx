/**
 * Plantillas de marketing de los productos FSV (FSV Search, SistemaW): página por función, índice de guías y guía.
 * Cada producto (lib/products.ts) aporta textos, rutas y llamados a la acción.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { Header } from "./Header";
import { CtaAndFooter } from "./Footer";
import { SITE_URL, type Product } from "@/lib/products";
import type { FeaturePage, Guide } from "@/lib/search-marketing";

/** JSON-LD seguro dentro de <script> (sin "</" que cierre la etiqueta). */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

export const breadcrumbLd = (items: [string, string][]) => ({
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: `${SITE_URL}${path}` })),
});

export function Breadcrumbs({ items }: { items: [string, string][] }) {
  return (
    <nav aria-label="Ruta" className="font-mono text-[11px] uppercase tracking-[0.16em] text-fsv-muted">
      {items.map(([name, path], i) => (
        <span key={path}>
          {i > 0 && <span className="mx-2" aria-hidden>/</span>}
          {i < items.length - 1 ? <Link href={path} className="transition hover:text-fsv-violet">{name}</Link> : <span className="text-fsv-ink">{name}</span>}
        </span>
      ))}
    </nav>
  );
}

const isExternal = (href: string) => /^https?:\/\//.test(href);
function A({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  return isExternal(href) ? <a href={href} className={className}>{children}</a> : <Link href={href} className={className}>{children}</Link>;
}

/** Botón principal y secundario del producto. */
export function CtaButtons({ product, dark = false }: { product: Product; dark?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <A href={product.primary.href} className="inline-flex items-center gap-2 rounded-sm bg-fsv-violet px-5 py-3 font-medium text-white transition hover:brightness-110">
        {product.primary.label} <span aria-hidden>→</span>
      </A>
      <A href={product.secondary.href} className={`font-medium underline decoration-fsv-violet decoration-2 underline-offset-[6px] transition hover:text-fsv-violet ${dark ? "text-white" : ""}`}>
        {product.secondary.label}
      </A>
    </div>
  );
}

export function ProductFooter({ product }: { product: Product }) {
  const f = product.footer;
  return <CtaAndFooter title={f.title} cta={f.cta} href={f.href} note={f.note} />;
}

/** Tarjetas con las funciones del producto (enlazado interno entre ellas). */
export function FeatureLinks({ product, exclude }: { product: Product; exclude?: string }) {
  const list = product.features.filter((f) => f.slug !== exclude);
  // 4 tarjetas en 3 columnas dejan un hueco: con cantidad par y no múltiplo de 3, mejor 2 columnas
  const cols = list.length % 3 !== 0 && list.length % 2 === 0 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <ul className={`grid gap-px overflow-hidden rounded-sm border border-fsv-line bg-fsv-line ${cols}`}>
      {list.map((f) => (
        <li key={f.slug} className="bg-white">
          <Link href={`${product.base}/${f.slug}`} className="group block h-full p-5 transition hover:bg-fsv-bg">
            <div className="font-display font-semibold tracking-tight transition group-hover:text-fsv-violet">{f.name} <span aria-hidden>→</span></div>
            <p className="mt-1 text-sm leading-snug text-fsv-muted">{f.description.split(".")[0]}.</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function GuideLinks({ product, only, exclude }: { product: Product; only?: string[]; exclude?: string }) {
  const list = product.guides.filter((g) => g.slug !== exclude && (!only || only.includes(g.slug)));
  return (
    <ul className="divide-y divide-fsv-line border-y border-fsv-line">
      {list.map((g) => (
        <li key={g.slug}>
          <Link href={`${product.base}/guias/${g.slug}`} className="group flex items-baseline justify-between gap-4 py-4">
            <span className="font-medium transition group-hover:text-fsv-violet">{g.title}</span>
            <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-fsv-muted">{g.minutes} min</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ---------- página por función ----------

export function featureMetadata(product: Product, f: FeaturePage | undefined, fallbackImg: string): Metadata {
  if (!f) return {};
  const path = `${product.base}/${f.slug}`;
  return {
    title: { absolute: f.title },
    description: f.description,
    alternates: { canonical: path },
    openGraph: { type: "website", url: path, title: f.title, description: f.description, images: [{ url: f.img?.src ?? fallbackImg }] },
    twitter: { card: "summary_large_image", title: f.title, description: f.description },
  };
}

export function FeaturePageView({ product, page: f }: { product: Product; page: FeaturePage }) {
  const crumbs: [string, string][] = [["FSV", "/"], [product.name, product.base], [f.name, `${product.base}/${f.slug}`]];
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", name: f.title, description: f.description, url: `${SITE_URL}${product.base}/${f.slug}`, inLanguage: "es", about: product.about },
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
              <CtaButtons product={product} />
            </div>
            {product.note && <p className="mt-4 text-sm text-fsv-muted">{product.note}</p>}
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
            <Faqs items={f.faq} />
            {f.guides.length > 0 && (
              <>
                <h2 className="mt-14 font-display text-xl font-semibold tracking-tight">Guías relacionadas</h2>
                <div className="mt-4">
                  <GuideLinks product={product} only={f.guides} />
                </div>
              </>
            )}
          </div>
        </section>

        <section className="border-t border-fsv-line bg-fsv-bg">
          <div className="mx-auto max-w-6xl px-4 py-14 md:px-6 md:py-16">
            <h2 className="font-display text-xl font-semibold tracking-tight">Más de {product.name}</h2>
            <div className="mt-6">
              <FeatureLinks product={product} exclude={f.slug} />
            </div>
          </div>
        </section>
      </main>
      <ProductFooter product={product} />
    </>
  );
}

export function Faqs({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-6 divide-y divide-fsv-line border-y border-fsv-line">
      {items.map(([q, a]) => (
        <details key={q} className="group py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
            <h3>{q}</h3>
            <span aria-hidden className="text-fsv-violet transition group-open:rotate-45">+</span>
          </summary>
          <p className="mt-3 text-sm leading-relaxed text-fsv-muted">{a}</p>
        </details>
      ))}
    </div>
  );
}

// ---------- guías ----------

export function guidesMetadata(product: Product): Metadata {
  const title = `${product.guidesTitle} — ${product.name}`;
  const path = `${product.base}/guias`;
  return { title: { absolute: title }, description: product.guidesDescription, alternates: { canonical: path }, openGraph: { type: "website", url: path, title, description: product.guidesDescription } };
}

export function GuidesIndexView({ product }: { product: Product }) {
  const crumbs: [string, string][] = [["FSV", "/"], [product.name, product.base], ["Guías", `${product.base}/guias`]];
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "CollectionPage", name: product.guidesTitle, url: `${SITE_URL}${product.base}/guias`, inLanguage: "es", hasPart: product.guides.map((g) => ({ "@type": "Article", headline: g.title, url: `${SITE_URL}${product.base}/guias/${g.slug}` })) },
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
          <h1 className="mt-8 font-display text-[2.3rem] font-semibold leading-[1.02] tracking-[-0.035em] md:text-[3.6rem]">{product.guidesTitle}</h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-fsv-ink/80">{product.guidesDescription}</p>
          <ul className="mt-12 grid gap-px overflow-hidden rounded-sm border border-fsv-line bg-fsv-line sm:grid-cols-2">
            {product.guides.map((g) => (
              <li key={g.slug} className="bg-white">
                <Link href={`${product.base}/guias/${g.slug}`} className="group block h-full p-6 transition hover:bg-fsv-bg">
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-fsv-muted">{g.minutes} min de lectura</div>
                  <h2 className="mt-2 font-display text-xl font-semibold leading-snug tracking-tight transition group-hover:text-fsv-violet">{g.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-fsv-muted">{g.description}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
      <ProductFooter product={product} />
    </>
  );
}

export function guideMetadata(product: Product, g: Guide | undefined, img: string): Metadata {
  if (!g) return {};
  const path = `${product.base}/guias/${g.slug}`;
  return {
    title: { absolute: `${g.title} — ${product.name}` },
    description: g.description,
    alternates: { canonical: path },
    openGraph: { type: "article", url: path, title: g.title, description: g.description, publishedTime: g.date, images: [img] },
    twitter: { card: "summary_large_image", title: g.title, description: g.description },
  };
}

export function GuideView({ product, guide: g, img }: { product: Product; guide: Guide; img: string }) {
  const feature = product.features.find((f) => f.slug === g.feature);
  const crumbs: [string, string][] = [["FSV", "/"], [product.name, product.base], ["Guías", `${product.base}/guias`], [g.title, `${product.base}/guias/${g.slug}`]];
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
        url: `${SITE_URL}${product.base}/guias/${g.slug}`,
        author: { "@type": "Organization", name: "FSV", url: SITE_URL },
        publisher: { "@type": "Organization", name: "FSV", url: SITE_URL, logo: { "@type": "ImageObject", url: `${SITE_URL}/brand/fsv-mark.png` } },
        image: `${SITE_URL}${img}`,
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
              <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-fsv-violet">Hazlo con {product.name}</div>
              <p className="mt-3 font-display text-xl font-semibold tracking-tight">{feature.h1}</p>
              <p className="mt-2 text-sm leading-relaxed text-fsv-muted">{feature.lead}</p>
              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
                <CtaButtons product={product} />
                <Link href={`${product.base}/${feature.slug}`} className="text-sm text-fsv-muted transition hover:text-fsv-ink">Ver {feature.name.toLowerCase()} →</Link>
              </div>
            </aside>
          )}
          <h2 className="mt-14 font-display text-xl font-semibold tracking-tight">Otras guías</h2>
          <div className="mt-4">
            <GuideLinks product={product} exclude={g.slug} />
          </div>
        </article>
      </main>
      <ProductFooter product={product} />
    </>
  );
}
