import Link from "next/link";
import { FEATURE_PAGES, GUIDES } from "@/lib/search-marketing";
import { planPriceClp, TRIAL_DAYS } from "@/lib/plans";

export const SITE_URL = "https://fsvc.cl";
export const price = () => planPriceClp().toLocaleString("es-CL");

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

/** Botones de conversión: prueba gratis (principal) y auditoría gratis de una página (sin cuenta). */
export function TrialButtons({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <Link href="/signup" className="inline-flex items-center gap-2 rounded-sm bg-fsv-violet px-5 py-3 font-medium text-white transition hover:brightness-110">
        Probar {TRIAL_DAYS} días gratis <span aria-hidden>→</span>
      </Link>
      <Link href="/search/auditoria-gratis" className={`font-medium underline decoration-fsv-violet decoration-2 underline-offset-[6px] transition hover:text-fsv-violet ${dark ? "text-white" : ""}`}>
        Auditar mi sitio gratis
      </Link>
    </div>
  );
}

/** Enlaces a las páginas de funciones (enlazado interno entre ellas). */
export function FeatureLinks({ exclude, only }: { exclude?: string; only?: string[] }) {
  const list = FEATURE_PAGES.filter((f) => f.slug !== exclude && (!only || only.includes(f.slug)));
  return (
    <ul className="grid gap-px overflow-hidden rounded-sm border border-fsv-line bg-fsv-line sm:grid-cols-2 lg:grid-cols-3">
      {list.map((f) => (
        <li key={f.slug} className="bg-white">
          <Link href={`/search/${f.slug}`} className="group block h-full p-5 transition hover:bg-fsv-bg">
            <div className="font-display font-semibold tracking-tight transition group-hover:text-fsv-violet">{f.name} <span aria-hidden>→</span></div>
            <p className="mt-1 text-sm leading-snug text-fsv-muted">{f.description.split(".")[0]}.</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function GuideLinks({ only, exclude }: { only?: string[]; exclude?: string }) {
  const list = GUIDES.filter((g) => g.slug !== exclude && (!only || only.includes(g.slug)));
  return (
    <ul className="divide-y divide-fsv-line border-y border-fsv-line">
      {list.map((g) => (
        <li key={g.slug}>
          <Link href={`/search/guias/${g.slug}`} className="group flex items-baseline justify-between gap-4 py-4">
            <span className="font-medium transition group-hover:text-fsv-violet">{g.title}</span>
            <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-fsv-muted">{g.minutes} min</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
