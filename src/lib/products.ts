/**
 * Productos FSV con páginas de marketing propias (función por página, guías, herramienta gratis). Las plantillas
 * (components/site/Marketing.tsx) son las mismas; cada producto define sus textos, rutas y llamados a la acción.
 */
import { planPriceClp, TRIAL_DAYS } from "./plans";
import { FEATURE_PAGES, GUIDES, type FeaturePage, type Guide } from "./search-marketing";
import { PENTEST_GUIDES, PENTEST_PAGES } from "./pentest-marketing";

export type Cta = { label: string; href: string };
export type Product = {
  name: string;
  /** ruta de la página principal (/search, /pentest) */
  base: string;
  primary: Cta;
  secondary: Cta;
  /** línea bajo los botones */
  note?: string;
  /** bloque oscuro del final */
  footer: { title: string; cta: string; href: string; note?: string };
  /** SoftwareApplication para el JSON-LD de cada página */
  about: Record<string, unknown>;
  features: FeaturePage[];
  guides: Guide[];
  guidesTitle: string;
  guidesDescription: string;
};

export const SITE_URL = "https://fsvc.cl";
export const priceClp = () => planPriceClp().toLocaleString("es-CL");

export function searchProduct(): Product {
  return {
    name: "FSV Search",
    base: "/search",
    primary: { label: `Probar ${TRIAL_DAYS} días gratis`, href: "/signup" },
    secondary: { label: "Auditar mi sitio gratis", href: "/search/auditoria-gratis" },
    note: `${TRIAL_DAYS} días gratis sin tarjeta · Desde $${priceClp()} al mes por perfil`,
    footer: { title: "Prueba FSV Search con tu sitio.", cta: `Probar ${TRIAL_DAYS} días gratis`, href: "/signup", note: `Luego $${priceClp()} al mes por perfil` },
    about: { "@type": "SoftwareApplication", name: "FSV Search", applicationCategory: "BusinessApplication", operatingSystem: "Web", offers: { "@type": "Offer", price: planPriceClp(), priceCurrency: "CLP" } },
    features: FEATURE_PAGES,
    guides: GUIDES,
    guidesTitle: "Guías de SEO",
    guidesDescription: "Lo esencial para posicionar tu sitio en Google, explicado en simple y en orden.",
  };
}

/** SistemaW: el software de evaluaciones de seguridad de FSV (la app vive en pentest.fsvc.cl). */
export const PENTEST_APP = "https://pentest.fsvc.cl/";

export function pentestProduct(): Product {
  return {
    name: "SistemaW",
    base: "/pentest",
    primary: { label: "Comenzar evaluación", href: PENTEST_APP },
    secondary: { label: "Revisar mi web gratis", href: "/pentest/revision-gratis" },
    note: "Solo sobre dominios verificados y con autorización registrada (Ley N° 21.663)",
    footer: { title: "Pon a prueba la seguridad de tu web.", cta: "Comenzar evaluación", href: PENTEST_APP, note: "O escríbenos para una evaluación a medida" },
    about: { "@type": "SoftwareApplication", name: "SistemaW", applicationCategory: "SecurityApplication", operatingSystem: "Web", url: PENTEST_APP },
    features: PENTEST_PAGES,
    guides: PENTEST_GUIDES,
    guidesTitle: "Guías de ciberseguridad",
    guidesDescription: "Pentest, cabeceras de seguridad y la Ley Marco de Ciberseguridad, explicados para equipos que no son de seguridad.",
  };
}
