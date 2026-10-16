import type { CheerioAPI } from "cheerio";
import type { StructuredSummary } from "./structured";
export type Commerce = {
  price?: number | null;
  currency?: string | null;
  availability?: string | null;
  sku?: string | null;
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
  const offer = Array.isArray(offers) ? offers[0] : (offers ?? {});
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
    availability:
      offer.availability ??
      (/\b(agotado|sin stock|out of stock)\b/i.test(
        $("main,body").first().text(),
      )
        ? "OutOfStock"
        : null),
    sku: product?.props.sku ? String(product.props.sku) : null,
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
