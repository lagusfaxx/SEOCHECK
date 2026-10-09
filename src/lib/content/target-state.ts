import { isHomeUrl, kwTokens } from "./match";

/**
 * Estado del formulario de Contenido (keyword + página a optimizar).
 *
 * La URL recuerda su origen:
 * - `suggestion`: elegida desde las sugerencias para una keyword concreta (`forKeyword`). Si la keyword cambia de forma
 *   significativa, la URL se limpia: nunca se analiza una página sugerida para otra búsqueda.
 * - `manual`: escrita (o pegada) por el usuario. No se borra al cambiar la keyword; si calza poco con la nueva keyword
 *   se muestra una advertencia hasta que elija una sugerida o decida mantenerla.
 */
export type TargetSource = "manual" | "suggestion";
export type TargetState = {
  keyword: string;
  url: string;
  source: TargetSource | null;
  /** keyword para la que se eligió la sugerencia */
  forKeyword: string | null;
  /** keyword para la que el usuario decidió «Mantener esta URL» pese a la advertencia */
  keptFor: string | null;
  /** la URL sugerida se limpió porque cambió la keyword (para explicarlo en pantalla) */
  cleared: boolean;
};

export type TargetAction =
  | { type: "keyword"; keyword: string }
  | { type: "typeUrl"; url: string }
  | { type: "pickSuggestion"; url: string }
  | { type: "keepManual" }
  | { type: "reset" };

export const initialTarget: TargetState = { keyword: "", url: "", source: null, forKeyword: null, keptFor: null, cleared: false };

/** ¿Cambió la keyword de forma significativa? Menos de la mitad de palabras en común (sin tildes, plurales ni vacías). */
export function keywordChanged(a: string | null, b: string): boolean {
  const x = new Set(kwTokens(a ?? "")), y = new Set(kwTokens(b));
  if (!x.size && !y.size) return false;
  const inter = [...x].filter((t) => y.has(t)).length;
  const union = new Set([...x, ...y]).size;
  return inter / union < 0.5;
}

export function targetReducer(s: TargetState, a: TargetAction): TargetState {
  switch (a.type) {
    case "keyword": {
      const next = { ...s, keyword: a.keyword };
      if (s.source === "suggestion" && s.url && keywordChanged(s.forKeyword, a.keyword))
        return { ...next, url: "", source: null, forKeyword: null, cleared: true };
      // «Mantener esta URL» vale para esa keyword; si cambia de verdad, se vuelve a evaluar
      if (s.keptFor && keywordChanged(s.keptFor, a.keyword)) return { ...next, keptFor: null };
      return next;
    }
    case "typeUrl":
      return { ...s, url: a.url, source: a.url.trim() ? "manual" : null, forKeyword: null, keptFor: null, cleared: false };
    case "pickSuggestion":
      return { ...s, url: a.url, source: "suggestion", forKeyword: s.keyword, keptFor: null, cleared: false };
    case "keepManual":
      return { ...s, keptFor: s.keyword };
    case "reset":
      return initialTarget;
  }
}

/**
 * ¿La URL manual calza razonablemente con la keyword? Sí si está entre las sugerencias de esta keyword
 * o si su ruta contiene más de la mitad de las palabras de la keyword (compartir solo «montessori» no basta
 * para «torre montessori»). La portada tiene su propio aviso (no se duplica aquí).
 */
export function manualRelevant(url: string, keyword: string, suggestionUrls: string[] = []): boolean {
  if (suggestionUrls.includes(url)) return true;
  const kw = kwTokens(keyword);
  if (!kw.length) return true;
  let full = url.trim();
  if (!/^https?:\/\//i.test(full)) full = `https://${full}`;
  let path = "";
  try {
    path = new URL(full).pathname;
  } catch {
    return false;
  }
  const inPath = new Set(kwTokens(path.replace(/[-_/.]/g, " ")));
  return kw.filter((t) => inPath.has(t)).length / kw.length > 0.5;
}

/** Advertencia «Esta página parece poco relacionada con la nueva keyword». */
export function lowRelevanceWarning(s: TargetState, suggestionUrls: string[] = []): boolean {
  if (s.source !== "manual" || !s.url.trim() || kwTokens(s.keyword).length === 0) return false;
  if (s.keptFor && !keywordChanged(s.keptFor, s.keyword)) return false;
  let full = s.url.trim();
  if (!/^https?:\/\//i.test(full)) full = `https://${full}`;
  if (isHomeUrl(full)) return false;
  return !manualRelevant(s.url, s.keyword, suggestionUrls);
}

/**
 * ¿Se puede enviar el análisis? Nunca con una URL sugerida para otra keyword, ni con una URL manual
 * poco relacionada sin que el usuario lo haya confirmado.
 */
export function canSubmit(s: TargetState, suggestionUrls: string[] = []): { ok: boolean; reason?: string } {
  if (!s.keyword.trim()) return { ok: false, reason: "Escribe la keyword" };
  if (!s.url.trim()) return { ok: false, reason: s.cleared ? "Elige de nuevo la página para esta keyword" : "Elige o escribe la página a optimizar" };
  if (s.source === "suggestion" && keywordChanged(s.forKeyword, s.keyword)) return { ok: false, reason: "La página elegida era para otra keyword: elige de nuevo" };
  if (lowRelevanceWarning(s, suggestionUrls)) return { ok: false, reason: "Confirma la página: parece poco relacionada con la keyword" };
  return { ok: true };
}
