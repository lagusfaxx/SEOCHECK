import type { MetadataRoute } from "next";
import { FEATURE_PAGES, GUIDES } from "@/lib/search-marketing";
import { PENTEST_GUIDES, PENTEST_PAGES } from "@/lib/pentest-marketing";

const BASE = "https://fsvc.cl";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, priority: 1 },
    { url: `${BASE}/search`, priority: 0.9 },
    { url: `${BASE}/search/auditoria-gratis`, priority: 0.9 },
    ...FEATURE_PAGES.map((f) => ({ url: `${BASE}/search/${f.slug}`, priority: 0.8 })),
    { url: `${BASE}/search/guias`, priority: 0.7 },
    ...GUIDES.map((g) => ({ url: `${BASE}/search/guias/${g.slug}`, lastModified: g.date, priority: 0.6 })),
    { url: `${BASE}/pentest`, priority: 0.9 },
    { url: `${BASE}/pentest/revision-gratis`, priority: 0.9 },
    ...PENTEST_PAGES.map((p) => ({ url: `${BASE}/pentest/${p.slug}`, priority: 0.8 })),
    { url: `${BASE}/pentest/guias`, priority: 0.7 },
    ...PENTEST_GUIDES.map((g) => ({ url: `${BASE}/pentest/guias/${g.slug}`, lastModified: g.date, priority: 0.6 })),
    { url: `${BASE}/capacidades`, priority: 0.8 },
    { url: `${BASE}/work`, priority: 0.8 },
    { url: `${BASE}/ventures`, priority: 0.8 },
    { url: `${BASE}/empresa`, priority: 0.5 },
    { url: `${BASE}/privacidad`, priority: 0.2 },
    { url: `${BASE}/terminos`, priority: 0.2 },
  ];
}
