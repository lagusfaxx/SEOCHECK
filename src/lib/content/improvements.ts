/**
 * «Qué debes mejorar»: el desglose del puntaje de Contenido traducido a frases.
 *
 * Reglas (cubiertas por tests):
 * - El color/estado sale SIEMPRE de los puntos de esa parte del score (`breakdown`), nunca del texto.
 * - Los conteos del texto salen de las mismas listas con que analyze.ts calculó esos puntos
 *   (terms, sections, paa, schema con umbral ⌈N·0,3⌉, mine.editorial vs targetWords).
 * - Sin datos (análisis en curso o campo ausente) → estado «pending», nunca se interpreta 0 como resultado.
 * - Nunca «Faltan …» con 0 faltantes; nunca verde con menos del 80% de los puntos.
 */

export type Level = "bad" | "warn" | "good" | "pending";
export type Area = "Contenido" | "Estructura" | "Schema" | "Extensión" | "Preguntas";
export type Improvement = { area: Area; level: Level; title: string; detail: string; points: number | null; max: number };

type R = {
  pageType?: string;
  breakdown?: Partial<Record<"terms" | "length" | "sections" | "paa" | "schema", number>>;
  terms?: { missing: boolean }[];
  sections?: { label: string; covered: boolean }[];
  paa?: { q: string; answered: boolean }[];
  schema?: { type: string; count: number; mine: boolean }[];
  competitors?: unknown[];
  mine?: { editorial?: number; words?: number };
  targetWords?: number;
};

/** Máximos de cada parte, iguales a los pesos de analyze.ts. */
export const maxPoints = (pageType?: string) => ({
  terms: pageType === "listing" ? 50 : 40,
  length: 15,
  sections: pageType === "listing" ? 10 : 20,
  paa: 15,
  schema: 10,
});

/** Estado a partir de los puntos: ≥80% bien, ≥50% mejorable, menos prioritario. */
export function levelOf(points: number, max: number): Exclude<Level, "pending"> {
  if (max > 0 && points / max >= 0.8) return "good";
  if (max > 0 && points / max >= 0.5) return "warn";
  return "bad";
}

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
const quote = (xs: string[]) => xs.map((x) => `«${x}»`).join(", ");
const num = (v: number) => v.toLocaleString("es-CL");

/** Schema «frecuente» con el mismo umbral que usa el score. */
export function commonSchema(r: R) {
  const N = r.competitors?.length ?? 0;
  return (r.schema ?? []).filter((s) => N > 0 && s.count >= Math.ceil(N * 0.3));
}

export function improvements(r: R, opts: { ready?: boolean } = {}): Improvement[] {
  const ready = opts.ready ?? true;
  const max = maxPoints(r.pageType);
  const b = r.breakdown ?? {};
  const pending = (area: Area, key: keyof typeof max): Improvement => ({ area, level: "pending", title: ready ? "Sin datos" : "Pendiente", detail: ready ? "Este análisis no tiene datos para esta parte." : "Se calcula al terminar el análisis.", points: null, max: max[key] });
  const has = (key: keyof typeof max, src: unknown) => ready && typeof b[key] === "number" && src !== undefined;
  // Las listas dicen «no falta nada» pero los puntos no están completos: datos incoherentes, no se interpretan.
  const incoherent = (area: Area, key: keyof typeof max): Improvement => ({ area, level: "pending", title: "Sin datos", detail: "Los datos de esta parte no coinciden con el puntaje; vuelve a correr el análisis.", points: b[key] ?? null, max: max[key] });

  const out: Improvement[] = [];

  // Contenido: términos que usan los competidores (mismos `terms` que pondera el score)
  if (!has("terms", r.terms)) out.push(pending("Contenido", "terms"));
  else {
    const p = b.terms!, level = levelOf(p, max.terms);
    const miss = r.terms!.filter((t) => t.missing).length;
    out.push({
      area: "Contenido", level, points: p, max: max.terms,
      ...(level === "good"
        ? { title: "Cubres los temas principales", detail: miss ? `Solo ${n(miss, "término secundario no aparece", "términos secundarios no aparecen")} en tu página.` : "Usas los términos que más se repiten en las páginas mejor posicionadas." }
        : miss
          ? { title: level === "bad" ? "Faltan temas importantes" : "Faltan algunos temas", detail: `${n(miss, "término relevante aparece", "términos relevantes aparecen")} en los competidores y no en tu página.` }
          : { title: "Temas poco desarrollados", detail: "Usas los términos del top 10, pero bastante menos que los competidores." }),
    });
  }

  // Estructura: secciones (H2) que se repiten en el top 10
  if (!has("sections", r.sections)) out.push(pending("Estructura", "sections"));
  else {
    const p = b.sections!, level = levelOf(p, max.sections);
    const miss = r.sections!.filter((s) => !s.covered).map((s) => s.label);
    const list = `${quote(miss.slice(0, 3))}${miss.length > 3 ? " y otras" : ""}`;
    if ((!r.sections!.length || miss.length === 0) && p < max.sections) out.push(incoherent("Estructura", "sections"));
    else out.push({
      area: "Estructura", level, points: p, max: max.sections,
      ...(!r.sections!.length
        ? { title: "Sin secciones en común", detail: "Los competidores no repiten secciones: no hay una estructura que imitar." }
        : miss.length === 0
          ? { title: "Estructura completa", detail: "Tu página cubre las secciones que se repiten en el top 10." }
          : level === "good"
            ? { title: `Casi completa: falta ${n(miss.length, "sección", "secciones")}`, detail: `Podrías agregar ${list}.` }
            : { title: `Falta${miss.length > 1 ? "n" : ""} ${n(miss.length, "sección importante", "secciones importantes")}`, detail: `Google espera contenido sobre ${list}.` }),
    });
  }

  // Schema: tipos que usa al menos el 30% del top 10 (mismo umbral del score)
  if (!has("schema", r.schema) || r.competitors === undefined) out.push(pending("Schema", "schema"));
  else {
    const p = b.schema!, level = levelOf(p, max.schema);
    const common = commonSchema(r);
    const miss = common.filter((s) => !s.mine).map((s) => s.type);
    if (miss.length === 0 && p < max.schema) out.push(incoherent("Schema", "schema"));
    else out.push({
      area: "Schema", level, points: p, max: max.schema,
      ...(!common.length
        ? { title: "Sin schema en común", detail: "Los competidores no comparten un tipo de datos estructurados." }
        : miss.length === 0
          ? { title: "Datos estructurados correctos", detail: `Usas ${common.map((s) => s.type).join(" y ")}, como los competidores.` }
          : { title: level === "good" ? "Datos estructurados casi completos" : "Datos estructurados mejorables", detail: `Tus competidores usan ${miss.join(" y ")}; tu página no.` }),
    });
  }

  // Extensión: palabras editoriales vs. mediana del top 10
  const words = r.mine?.editorial ?? r.mine?.words;
  if (!has("length", words) || r.targetWords === undefined) out.push(pending("Extensión", "length"));
  else {
    const p = b.length!, level = levelOf(p, max.length);
    out.push({
      area: "Extensión", level, points: p, max: max.length,
      ...(level === "good"
        ? { title: "Extensión correcta", detail: `${num(words!)} palabras. No necesitas alargar el contenido solo por alargarlo.` }
        : { title: "Contenido corto", detail: `${num(words!)} palabras; las páginas mejor posicionadas usan ~${num(r.targetWords)}.` }),
    });
  }

  // Preguntas de Google (PAA)
  if (!has("paa", r.paa)) out.push(pending("Preguntas", "paa"));
  else {
    const p = b.paa!, level = levelOf(p, max.paa);
    const miss = r.paa!.filter((q) => !q.answered).map((q) => q.q);
    if (miss.length === 0 && p < max.paa) out.push(incoherent("Preguntas", "paa"));
    else out.push({
      area: "Preguntas", level, points: p, max: max.paa,
      ...(!r.paa!.length
        ? { title: "Sin preguntas de Google", detail: "Google no muestra preguntas para esta búsqueda." }
        : miss.length === 0
          ? { title: "Preguntas cubiertas", detail: "Respondes las preguntas que muestra Google." }
          : { title: `${n(miss.length, "pregunta de Google", "preguntas de Google")} sin responder`, detail: `Por ejemplo: ${quote(miss.slice(0, 2))}.` }),
    });
  }

  const order: Record<Level, number> = { bad: 0, warn: 1, pending: 2, good: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/** Color por estado: la UI lo toma de aquí para que color y estado no puedan divergir. */
export const LEVEL_DOT: Record<Level, string> = { bad: "bg-rose-500", warn: "bg-amber-400", good: "bg-emerald-500", pending: "bg-ink-300" };
export const LEVEL_LABEL: Record<Level, string> = { bad: "prioritario", warn: "mejorable", good: "bien", pending: "sin datos" };
