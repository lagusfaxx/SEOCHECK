/**
 * Limpieza de keywords para Google Ads (DataForSEO y similares). Un solo keyword inválido puede
 * tumbar el task completo, así que se limpia y valida antes de enviar.
 *
 * Inválidos según DataForSEO/Google Ads: , ! @ % ^ * ( ) = { } ; ~ ` < > ? \ | ―
 * más emojis/caracteres de 4 bytes. Límites: 80 caracteres y 10 palabras.
 * Se quitan también ¿ ¡ (aparecen en preguntas PAA en español).
 */
const INVALID = /[,!@%^*()={};~`<>?\\|―¿¡"“”«»]/g;
const FOUR_BYTE = /[\u{10000}-\u{10FFFF}]/gu;

export type Cleaned = { valid: Map<string, string[]>; rejected: { term: string; reason: string }[] };

export function cleanKeyword(term: string): string {
  return term
    .normalize("NFC")
    .toLowerCase()
    .replace(FOUR_BYTE, " ")
    .replace(INVALID, " ")
    .replace(/[^\p{L}\p{N}\s&'.\-+#/]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Devuelve keyword limpia → términos originales que la producen, y los rechazados con motivo. */
export function sanitizeKeywords(terms: string[]): Cleaned {
  const valid = new Map<string, string[]>();
  const rejected: Cleaned["rejected"] = [];
  for (const t of terms) {
    const c = cleanKeyword(t);
    if (!c) rejected.push({ term: t, reason: "vacía tras limpiar" });
    else if (c.length > 80) rejected.push({ term: t, reason: "más de 80 caracteres" });
    else if (c.split(" ").length > 10) rejected.push({ term: t, reason: "más de 10 palabras" });
    else valid.set(c, [...(valid.get(c) ?? []), t]);
  }
  return { valid, rejected };
}
