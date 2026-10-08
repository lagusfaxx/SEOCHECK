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
