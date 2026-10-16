/**
 * Datos estructurados contra lo visible: Google exige que precio, disponibilidad y reseñas del JSON-LD
 * coincidan con lo que ve el usuario. Un precio desactualizado o un rating sin reseñas visibles puede
 * quitar los resultados enriquecidos o terminar en una acción manual.
 */

const types = (n: any): string[] => [].concat(n?.["@type"] ?? []).map((t: any) => String(t).toLowerCase());
const arr = (x: any): any[] => (x == null ? [] : Array.isArray(x) ? x : [x]);

/** Números que aparecen en el texto visible, con separadores de miles chilenos o internacionales. */
export function visibleNumbers(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/\d{1,3}(?:[.\s,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g,
  )) {
    const raw = m[0].replace(/\s/g, "");
    // "59.990" y "59,990" son miles; "59,99" o "59.99" son decimales
    const dec = /[.,]\d{1,2}$/.exec(raw);
    const intPart = (dec ? raw.slice(0, dec.index) : raw).replace(/[.,]/g, "");
    const n = Number(dec ? `${intPart}.${dec[0].slice(1)}` : intPart);
    if (Number.isFinite(n)) {
      out.add(n);
      out.add(Math.round(n));
    }
  }
  return out;
}

const OUT_OF_STOCK = /\b(agotad[oa]s?|sin stock|out of stock|no disponible)\b/i;
const REVIEWS = /(reseñ|opini|valoraci|calificaci|review|estrella|★)/i;

/** Problemas de Product/Offer/AggregateRating frente al texto visible de la página. */
export function checkStructuredData(
  nodes: any[],
  visibleText: string,
): string[] {
  const issues: string[] = [];
  const products = nodes.filter((n) =>
    types(n).some((t) => t === "product" || t === "productgroup"),
  );
  const visible = visibleText
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const present = (v: unknown) => {
    const t = String(v ?? "")
      .replace(/<[^>]*>/g, " ")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    return !t || visible.includes(t);
  };
  for (const n of nodes) {
    if (types(n).includes("faqpage"))
      for (const q of arr(n.mainEntity)) {
        if (!present(q.name) || !present(q.acceptedAnswer?.text))
          issues.push(
            "FAQ declara una pregunta o respuesta no encontrada en el texto visible: verificar",
          );
      }
    if (types(n).includes("breadcrumblist"))
      for (const item of arr(n.itemListElement))
        if (!present(item.name ?? item.item?.name))
          issues.push(
            "Breadcrumb declara un nombre no encontrado en la página: verificar",
          );
  }
  if (!products.length) return [...new Set(issues)];
  const nums = visibleNumbers(visibleText);
  const prices = new Set<number>();
  const availability: string[] = [];
  let currencyMissing = false,
    offersMissing = false;
  for (const p of products) {
    const offers = [
      ...arr(p.offers),
      ...arr(p.hasVariant).flatMap((v: any) => arr(v?.offers)),
    ];
    if (!offers.length) offersMissing = true;
    for (const o of offers) {
      for (const k of ["price", "lowPrice", "highPrice"]) {
        const v = Number(
          String(o?.[k] ?? o?.priceSpecification?.[k] ?? "").replace(/,/g, "."),
        );
        if (o?.[k] != null && Number.isFinite(v) && v > 0) prices.add(v);
      }
      if (
        o &&
        (o.price != null || o.lowPrice != null) &&
        !(o.priceCurrency ?? o.priceSpecification?.priceCurrency)
      )
        currencyMissing = true;
      if (o?.availability) availability.push(String(o.availability));
    }
    if ((p.aggregateRating || p.review) && !REVIEWS.test(visibleText))
      issues.push(
        "tiene aggregateRating/review pero la página no muestra reseñas visibles",
      );
  }
  if (offersMissing)
    issues.push("Product sin offers: no califica para resultados de producto");
  if (currencyMissing) issues.push("offer sin priceCurrency");
  const missing = [...prices].filter(
    (v) => !nums.has(v) && !nums.has(Math.round(v)),
  );
  if (prices.size && missing.length === prices.size)
    issues.push(
      `precio del JSON-LD (${[...prices].slice(0, 3).join(", ")}) no aparece en la página`,
    );
  if (
    availability.length &&
    availability.every((a) => /InStock/i.test(a)) &&
    OUT_OF_STOCK.test(visibleText) &&
    !/\b(en stock|disponible)\b/i.test(visibleText)
  )
    issues.push("JSON-LD dice InStock pero la página muestra agotado");
  return [...new Set(issues)];
}
