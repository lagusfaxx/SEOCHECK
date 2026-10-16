/**
 * Antes de que una keyword se convierta en tarea: ¿es del rubro del sitio? ¿ya hay una página que la cubre?
 *
 * - Marca propia («taupoc», «taupoc swimwear») → la cubre la página que ya recibe esas búsquedas (o la home).
 * - Todas las palabras que definen el tema están en el vocabulario del sitio (titles y H1 del crawl, consultas de
 *   Search Console) → candidata; si una página existente ya la trata, se optimiza esa en vez de crear otra.
 * - Alguna palabra que el sitio nunca menciona («miss universo», «simpson», «speedo», «fastskin») → no es tarea:
 *   puede ser una marca que no se vende, un producto ajeno u otra intención. Se lista aparte para revisar.
 */
import { isBrandQuery } from "./report-rules";

/** Palabras que no definen el tema (público, lugar, compra, colores, tallas). */
const GENERIC = new Set(
  "para con sin los las del una uno unos unas que como mas muy por sus este esta cual cuales donde cuando quien mujer mujeres hombre hombres nino nina ninos ninas infantil adulto adultos unisex chile santiago online tienda tiendas comprar compra precio precios oferta ofertas barato barata baratos venta ventas mejor mejores nuevo nueva nuevos envio gratis original originales marca marcas talla tallas color colores negro negra blanco blanca azul rojo roja rosado verde gris morado purpura amarillo modelo modelos tipo tipos new"
    .split(" "),
);
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Raíz simple: plural en -es/-s fuera (trajes → traje, zapatillas → zapatilla). */
const stem = (w: string) => (w.length > 5 && w.endsWith("es") ? w.slice(0, -2) : w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w);
export const topicWords = (text: string) =>
  [
    ...new Set(
      fold(text)
        .split(/[^a-z0-9ñ]+/)
        .filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !GENERIC.has(w))
        .map(stem),
    ),
  ];

export type TriageContext = {
  /** palabras del tema del sitio (ver siteVocabulary) */
  vocab: Set<string>;
  /** marca propia (de brandFromDomain) */
  brand: string;
  home: string;
  /** páginas del crawl que responden 200: título + H1 */
  pages: { url: string; text: string }[];
  /** filas de Search Console agregadas por consulta y página */
  gsc: { query: string; page: string; impressions: number }[];
};
export type Verdict = "brand" | "existing" | "create" | "unknown_terms" | "off_topic";
export type Triage = { keyword: string; verdict: Verdict; page: string | null; unknown: string[]; reason: string };

/** Vocabulario del sitio: títulos y H1 de sus páginas y las consultas por las que ya aparece en Google. */
export function siteVocabulary(texts: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const t of texts) for (const w of topicWords(t)) out.add(w);
  return out;
}

export function triageKeyword(keyword: string, ctx: TriageContext): Triage {
  const words = topicWords(keyword);
  // la página que ya recibe impresiones por una consulta equivalente (mismas palabras de tema)
  const sameTopic = (q: string) => {
    const qw = topicWords(q);
    if (!qw.length || !words.length) return false;
    const inter = qw.filter((w) => words.includes(w)).length;
    return inter / new Set([...qw, ...words]).size >= 0.6;
  };
  const gscPage = () => {
    const best = new Map<string, number>();
    for (const r of ctx.gsc) if (fold(r.query) === fold(keyword) || sameTopic(r.query)) best.set(r.page, (best.get(r.page) ?? 0) + r.impressions);
    return [...best.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  if (isBrandQuery(keyword, ctx.brand)) {
    const page = gscPage() ?? ctx.home;
    return { keyword, verdict: "brand", page, unknown: [], reason: `búsqueda de la marca propia: ya la cubre ${page}` };
  }
  if (!words.length) return { keyword, verdict: "off_topic", page: null, unknown: [], reason: "solo palabras genéricas: no define un tema" };
  const unknown = words.filter((w) => !ctx.vocab.has(w));
  if (unknown.length === words.length) return { keyword, verdict: "off_topic", page: null, unknown, reason: "ninguna palabra de la búsqueda aparece en el sitio: otro rubro" };
  if (unknown.length)
    return { keyword, verdict: "unknown_terms", page: null, unknown, reason: `el sitio no menciona «${unknown.join("», «")}» (puede ser una marca o producto que no se vende, u otra intención)` };
  const fromGsc = gscPage();
  if (fromGsc) return { keyword, verdict: "existing", page: fromGsc, unknown: [], reason: `${fromGsc} ya aparece en Google por búsquedas equivalentes: optimizar esa página` };
  // la página cuyo title/H1 cubre más palabras de la búsqueda; con 3 de 4 (75 %) o más, se optimiza esa
  const best = ctx.pages
    .map((p) => {
      const pw = new Set(topicWords(p.text));
      return { url: p.url, cover: words.filter((w) => pw.has(w)).length / words.length };
    })
    .sort((a, b) => b.cover - a.cover)[0];
  if (best && best.cover >= 0.75)
    return { keyword, verdict: "existing", page: best.url, unknown: [], reason: `${best.url} ya trata el tema en su title/H1: optimizar esa página` };
  return { keyword, verdict: "create", page: null, unknown: [], reason: "del rubro del sitio y sin página que lo cubra" };
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  brand: "marca propia: ya cubierta",
  existing: "optimizar página existente",
  create: "crear página (confirmar oferta)",
  unknown_terms: "revisar: términos que el sitio no menciona",
  off_topic: "otro rubro: descartada",
};
