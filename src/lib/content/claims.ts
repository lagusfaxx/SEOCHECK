import type { Brief } from "./analyze";
export class BriefValidationError extends Error {
  status = 400;
}
export function validateBrief(value: unknown): asserts value is Brief {
  const b = value as Brief;
  if (
    !b ||
    typeof b !== "object" ||
    !Array.isArray(b.titles) ||
    !Array.isArray(b.metas) ||
    !Array.isArray(b.outline) ||
    !Array.isArray(b.faq)
  )
    throw new BriefValidationError("Brief inválido");
  if (JSON.stringify(b).length > 200000)
    throw new BriefValidationError("Brief demasiado grande");
  for (const list of [b.titles, b.metas, b.filters ?? [], b.notes ?? []])
    if (!Array.isArray(list) || !list.every((x) => typeof x === "string"))
      throw new BriefValidationError("El brief debe contener textos");
  if (
    !b.outline.every(
      (x) =>
        x &&
        typeof x.id === "string" &&
        typeof x.text === "string" &&
        (x.notes == null || typeof x.notes === "string") &&
        ["h2", "h3"].includes(x.tag) &&
        (x.state == null ||
          ["optional", "required", "removed"].includes(x.state)),
    )
  )
    throw new BriefValidationError("Encabezados inválidos");
  if (
    !b.faq.every((x) => x && typeof x.q === "string" && typeof x.a === "string")
  )
    throw new BriefValidationError("FAQ inválido");
  if (
    b.kind != null &&
    !["article", "listing", "landing", "product"].includes(b.kind)
  )
    throw new BriefValidationError("Tipo de página inválido");
  for (const text of [b.intro, (b as any).title, (b as any).meta])
    if (text != null && typeof text !== "string")
      throw new BriefValidationError("Texto del brief inválido");
  if (
    b.links != null &&
    (!Array.isArray(b.links) ||
      !b.links.every(
        (l) => l && typeof l.anchor === "string" && typeof l.to === "string",
      ))
  )
    throw new BriefValidationError("Enlaces inválidos");
}

export function validateBusinessClaims(brief: Brief, source: string) {
  const text = JSON.stringify(brief),
    hay = source.toLocaleLowerCase();
  const claims = [
    ...text.matchAll(
      /(?:[$€£]\s?\d[\d.,]*|\d[\d.,]*\s?(?:CLP|USD|EUR)|(?:garant[ií]a|descuento|env[ií]o gratis|devoluci[oó]n gratuita|certificad[oa])[^"\n]{0,60})/gi,
    ),
  ].map((m) => m[0]);
  return claims.filter((c) => !hay.includes(c.toLocaleLowerCase()));
}
export function validateGeneratedClaims(brief: Brief, source: string): Brief {
  validateBrief(brief);
  const claims = validateBusinessClaims(brief, source);
  if (claims.length)
    throw new Error(`Datos del negocio sin respaldo: ${claims.join("; ")}`);
  return brief;
}

/**
 * Afirmaciones comerciales y de público que el brief no puede introducir si la página propia no las respalda:
 * superlativos de rendimiento ("rendimiento óptimo") y líneas o públicos ("oferta infantil", "para hombre").
 */
const SOFT_CLAIMS: { re: RegExp; what: string }[] = [
  { re: /\b(rendimiento|desempeño|calidad|resultado)s? (óptim[oa]s?|superior(es)?|máxim[oa]s?|insuperables?)\b/gi, what: "superlativo de rendimiento" },
  { re: /\b(el|la|los|las) mejor(es)?\b[^.,;"]{0,40}/gi, what: "superlativo" },
  { re: /\bl[ií]der(es)? (en|del)\b[^.,;"]{0,40}/gi, what: "liderazgo de mercado" },
  { re: /\b(alta|máxima|primera) calidad\b/gi, what: "calidad no comprobada" },
  { re: /\b(infantil(es)?|niñ[oa]s|niñ[oa]|bebés?|juvenil(es)?)\b/gi, what: "público o línea de producto" },
  { re: /\b(para )?(hombres?|mujer(es)?|damas?|caballeros?)\b/gi, what: "público o línea de producto" },
  { re: /\b(stock|disponibilidad) (inmediat[oa]|garantizad[oa]|permanente)\b/gi, what: "disponibilidad" },
  { re: /\bdespacho (gratis|el mismo día|en 24 ?h(oras)?)\b/gi, what: "condición de despacho" },
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export type BriefCheckInput = {
  /** texto de la página propia (y de lo que se sepa del sitio) */
  ownText: string;
  /** URLs internas que existen (crawl + links de la página) */
  knownUrls: string[];
  /** URL de la página analizada, para resolver rutas relativas */
  base: string;
};

/** Ruta normalizada sin barra final ni query para comparar links propuestos con los existentes. */
function pathKey(u: string, base: string): string | null {
  try {
    const x = new URL(u, base);
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return null;
  }
}

/**
 * Verifica un brief contra datos reales del sitio antes de guardarlo:
 * - links internos: solo hacia rutas que existen (las demás se descartan y se avisa);
 * - filtros: los que la página ya muestra no se proponen como nuevos;
 * - afirmaciones comerciales o de público sin respaldo en la página: se avisan para verificar o quitar.
 */
export function verifyBrief(brief: Brief, input: BriefCheckInput): Brief {
  const warnings = [...(brief.warnings ?? [])];
  const known = new Set(input.knownUrls.map((u) => pathKey(u, input.base)).filter(Boolean) as string[]);
  const links: { anchor: string; to: string }[] = [];
  for (const l of brief.links ?? []) {
    const k = pathKey(l.to, input.base);
    // "to" que no es una URL ni una ruta ("otra comuna") tampoco se puede implementar tal cual
    if (k && /^(https?:\/\/|\/)/.test(l.to.trim()) && known.has(k)) links.push(l);
    else warnings.push(`Enlace descartado: «${l.to}» no existe entre las URLs rastreadas del sitio. Proponer solo rutas reales.`);
  }
  const own = norm(input.ownText);
  const filters: string[] = [];
  for (const f of brief.filters ?? []) {
    if (f.trim().length >= 3 && own.includes(norm(f.trim()))) warnings.push(`Filtro «${f}» no se propone: la página ya lo muestra.`);
    else filters.push(f);
  }
  // solo el texto que el brief propone publicar; las preguntas y encabezados pueden venir tal cual de Google
  const text = [brief.intro ?? "", ...brief.titles, ...brief.metas, ...brief.faq.map((x) => x.a)].join("\n");
  const seen = new Set<string>();
  for (const { re, what } of SOFT_CLAIMS)
    for (const m of text.matchAll(re)) {
      const claim = m[0].trim();
      if (seen.has(norm(claim)) || own.includes(norm(claim))) continue;
      // el público o la línea cuenta como respaldado si la palabra clave aparece en la página
      const key = norm(claim).replace(/^(para|el|la|los|las) /, "").split(" ")[0];
      if (what === "público o línea de producto" && own.includes(key)) continue;
      seen.add(norm(claim));
      warnings.push(`Afirmación sin respaldo en la página (${what}): «${claim}». Verificar con datos reales del negocio o quitarla.`);
    }
  return { ...brief, links: brief.links ? links : brief.links, filters: brief.filters ? filters : brief.filters, warnings: [...new Set(warnings)] };
}
