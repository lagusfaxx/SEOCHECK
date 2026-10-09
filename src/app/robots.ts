import type { MetadataRoute } from "next";

/** Solo el sitio público se indexa; la app (FSV Search) y la API no. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/"], disallow: ["/app", "/p/", "/api/", "/login", "/setup", "/forgot", "/reset"] },
    sitemap: "https://fsvc.cl/sitemap.xml",
  };
}
