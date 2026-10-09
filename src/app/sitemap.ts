import type { MetadataRoute } from "next";

const BASE = "https://fsvc.cl";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, priority: 1 },
    { url: `${BASE}/search`, priority: 0.9 },
    { url: `${BASE}/capacidades`, priority: 0.8 },
    { url: `${BASE}/work`, priority: 0.8 },
    { url: `${BASE}/ventures`, priority: 0.8 },
    { url: `${BASE}/empresa`, priority: 0.5 },
  ];
}
