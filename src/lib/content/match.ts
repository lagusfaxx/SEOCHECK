import { strip } from "../text";

/**
 * Calce keyword ↔ página, sin dependencias de servidor: lo usan las sugerencias (servidor)
 * y el formulario de Contenido (navegador) para avisar si una URL calza poco con la keyword.
 */

const STOP = new Set(["con", "para", "los", "las", "del", "que", "una", "por", "www", "html", "php"]);

/** Tokens comparables: sin tildes, sin palabras vacías cortas y con un singular aproximado ("balancines" → "balancin"). */
export function kwTokens(text: string): string[] {
  return [
    ...new Set(
      strip(text)
        .replace(/[^a-z0-9ñ]+/g, " ")
        .split(" ")
        .filter((t) => t.length > 2 && !STOP.has(t))
        .map(stem),
    ),
  ];
}

function stem(t: string) {
  if (t.length > 5 && t.endsWith("es")) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith("s")) return t.slice(0, -1);
  return t;
}

export const isHomeUrl = (u: string) => {
  try {
    return new URL(u).pathname.replace(/\/+$/, "") === "";
  } catch {
    return false;
  }
};

export type PageCandidate = { url: string; title: string | null; h1: string[] };

/**
 * Puntaje de calce: tokens de la keyword en la ruta (pesa más), el H1 y el title.
 * La portada no se excluye: se penaliza cuando la keyword es específica (2+ palabras que no son la marca),
 * así puede ganar cuando realmente es la página más relevante (p. ej. la keyword es el nombre del negocio).
 */
export function scorePage(kw: string[], p: PageCandidate, brand: string[] = []): number {
  if (!kw.length) return 0;
  let path = "";
  try {
    path = new URL(p.url).pathname;
  } catch {
    return 0;
  }
  const inPath = new Set(kwTokens(path.replace(/[-_/.]/g, " ")));
  const inH1 = new Set(kwTokens(p.h1.join(" ")));
  const inTitle = new Set(kwTokens(p.title ?? ""));
  let s = 0;
  let hits = 0;
  for (const t of kw) {
    if (inPath.has(t) || inH1.has(t) || inTitle.has(t)) hits++;
    s += (inPath.has(t) ? 3 : 0) + (inH1.has(t) ? 2 : 0) + (inTitle.has(t) ? 1 : 0);
  }
  if (!hits) return 0;
  // calce parcial vale menos: con 1 de 3 palabras no basta para recomendar
  s *= hits / kw.length;
  if (isHomeUrl(p.url) && isSpecific(kw, brand)) s *= 0.35;
  return Math.round(s * 10) / 10;
}

/** Keyword específica: 2+ palabras y no es (solo) la marca del sitio. */
export function isSpecific(kw: string[], brand: string[] = []) {
  return kw.filter((t) => !brand.includes(t)).length >= 2;
}

/** Tokens de la marca a partir del dominio ("sin-tornillo.cl" → sin, tornillo, sintornillo). */
export const brandOf = (domain: string) => {
  const label = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split(".")[0];
  return [...new Set([...kwTokens(label.replace(/-/g, " ")), ...kwTokens(label.replace(/-/g, ""))])];
};


