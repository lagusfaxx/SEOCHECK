import type { CheerioAPI } from "cheerio";
import type { StructuredSummary } from "./structured";
export type Commerce = {
  price?: number | null;
  currency?: string | null;
  availability?: string | null;
  sku?: string | null;
  /** código del fabricante: distingue productos distintos que el sitio marca con el mismo SKU */
  mpn?: string | null;
  name?: string | null;
  productLinks?: number;
  pagination?: {
    next?: string | null;
    prev?: string | null;
    infinite?: boolean;
    pageLinks?: number;
  };
  filters?: string[];
};
export function commerceSignals(
  $: CheerioAPI,
  url: string,
  s: StructuredSummary,
): Commerce {
  const product = [...s.jsonld, ...s.microdata, ...s.rdfa].find((e) =>
    /^(Product|ProductGroup)$/.test(e.type),
  );
  const offers: any = product?.props.offers;
  const list: any[] = (Array.isArray(offers) ? offers : offers ? [offers] : []).filter((o) => o && typeof o === "object");
  const offer = list[0] ?? {};
  // con varias ofertas (tallas, colores) el producto está disponible si alguna lo está: no basta con la primera
  const availability =
    list.find((o) => /InStock|LimitedAvailability|PreOrder|BackOrder|OnlineOnly|InStoreOnly/i.test(String(o.availability ?? "")))?.availability ??
    offer.availability;
  const raw =
    offer.price ??
    $('meta[property="product:price:amount"], [itemprop="price"]')
      .first()
      .attr("content");
  const price =
    raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
  const link = (rel: string) => {
    const l = $(`link[rel="${rel}"],a[rel="${rel}"]`).first().attr("href");
    try {
      return l ? new URL(l, url).href : null;
    } catch {
      return null;
    }
  };
  return {
    price,
    currency:
      offer.priceCurrency ??
      $('meta[property="product:price:currency"], [itemprop="priceCurrency"]').first().attr("content") ??
      null,
    // sin datos estructurados: solo el botón o el indicador de stock, no cualquier «agotado» de la página (otra talla,
    // un producto relacionado o un texto de ayuda harían pasar por agotada una ficha que se vende)
    availability:
      availability ??
      (/\b(agotado|sin stock|out of stock)\b/i.test(
        $("button, [class*='stock' i], [class*='availability' i], [class*='disponib' i], [itemprop='availability']").text(),
      )
        ? "OutOfStock"
        : null),
    sku: product?.props.sku ? String(product.props.sku) : null,
    mpn: product?.props.mpn ? String(product.props.mpn) : null,
    name: product?.props.name ? String(product.props.name) : null,
    productLinks: $("a[href*='/products/'],a[href*='/producto/']").length,
    pagination: {
      next: link("next"),
      prev: link("prev"),
      infinite: $("[data-infinite-scroll],.infinite-scroll").length > 0,
      pageLinks: $("a[href*='page=']").length,
    },
    filters: [...new URL(url).searchParams.keys()],
  };
}
