import type { PageData, TextBlock } from "../audit/crawler";
import { strip } from "../text";

/** Palabras de interfaz (botones, avisos, reproductores): no son términos de contenido. */
export const STOP_UI = new Set(
  `consultar consulta consultas ver mas cargar cargando navegador navegadores soporta soportado compatible video videos audio
  click clic clickea haz aqui inicio menu buscar busca buscador iniciar sesion ingresar ingresa registrate registrarse registro
  cookies cookie aceptar acepto rechazar politica politicas privacidad terminos condiciones derechos reservados copyright
  compartir comparte siguiente anterior volver cerrar abrir mostrar ocultar leer seguir filtrar filtro filtros ordenar orden
  pagina paginas todos todas publicar publica anuncio anuncios contacto contactanos enviar mensaje suscribete suscribirse
  descargar descarga actualiza actualizar version javascript habilita habilitar html5 elemento etiqueta reproducir
  cargar mas resultados resultado mostrando favoritos favorito agregar quitar editar perfil cuenta usuario usuarios
  edad mayor mayores años confirmo confirmar salir entrar ok aceptar ahora nuevo nueva nuevos nuevas`.split(/\s+/).filter(Boolean)
);

const key = (t: string) => strip(t).replace(/[^a-z0-9ñ ]/g, "").replace(/\s+/g, " ").trim();

/**
 * Boilerplate de un dominio: bloques que se repiten en ≥ 50% de las páginas muestreadas de ese dominio
 * (menús, footer, botones, avisos de cookies/edad). Las páginas de la muestra son de otras secciones del sitio
 * (ver siblingsOf), así lo que se repite es el "marco" y no el contenido. Con menos de 2 páginas: vacío.
 */
export function boilerplateOf(pages: PageData[]): Set<string> {
  const out = new Set<string>();
  if (pages.length < 2) return out;
  const count = new Map<string, number>();
  for (const p of pages) for (const k of new Set(p.blocks.map((b) => key(b.t)).filter(Boolean))) count.set(k, (count.get(k) ?? 0) + 1);
  for (const [k, n] of count) if (n / pages.length >= 0.5) out.add(k);
  return out;
}

export const isBoiler = (b: TextBlock, boiler: Set<string>) => boiler.has(key(b.t));

/** Texto para extraer términos: sin navegación/footer, sin boilerplate del dominio. */
export function contentText(p: PageData, boiler: Set<string>): string {
  const blocks = p.blocks.filter((b) => !b.chrome && !isBoiler(b, boiler));
  // sin bloques (HTML raro): el texto plano de siempre
  return blocks.length ? blocks.map((b) => b.t).join(" \n ") : p.text;
}

/** Bloques editoriales: frases de verdad, no tarjetas, menús ni botones. */
export function editorialBlocks(p: PageData, boiler: Set<string>): TextBlock[] {
  return p.blocks.filter((b) => !b.chrome && !isBoiler(b, boiler) && b.link < 0.5 && b.w >= 8 && !/^(h[1-6]|button|label|td|th)$/.test(b.tag));
}

export const editorialWords = (p: PageData, boiler: Set<string>) => editorialBlocks(p, boiler).reduce((s, b) => s + b.w, 0);

/** "Las Condes", "La Reina", "Lo Barnechea": artículo + nombre propio (en el texto original, con mayúsculas). */
export function properNounLeads(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(La|Las|Los|Lo|El)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/g)) out.add(strip(`${m[1]} ${m[2]}`));
  return out;
}

export type PageType = "listing" | "detail" | "article" | "home";
export const PAGE_TYPE_LABEL: Record<PageType, string> = { listing: "listado", detail: "ficha", article: "artículo", home: "home" };

/** Tipo de página a partir de URL, schema, tarjetas y texto editorial. */
export function classifyPage(url: string, p: PageData, editorial: number): PageType {
  let path = "/";
  try {
    path = new URL(p.finalUrl || url).pathname;
  } catch {}
  if (path === "/" || path === "") return "home";
  const types = p.jsonldTypes.map((t) => t.toLowerCase());
  const has = (...xs: string[]) => xs.some((x) => types.includes(x));
  const h2 = p.headings.filter((h) => h.tag === "h2").length;
  const s = p.signals;
  if (has("article", "blogposting", "newsarticle", "techarticle")) return "article";
  if (has("product", "offer", "aggregateoffer")) return "detail";
  if (has("itemlist", "collectionpage", "searchresultspage")) return "listing";
  if (s.linkGroup >= 8 && editorial < 600) return "listing";
  // URLs de categoría/etiqueta/búsqueda: listados aunque tengan pocos ítems
  if (/\/(categor[a-z]*|tag|tags|etiqueta|busqueda|buscar|search|listado|directorio)(\/|$)/i.test(path) && editorial < 600) return "listing";
  if (s.cart) return "detail";
  if ((s.article || s.time) && editorial >= 400) return "article";
  if (editorial >= 700 && h2 >= 3) return "article";
  if (s.linkGroup >= 8) return "listing";
  if (has("person", "profilepage", "localbusiness") || s.price) return "detail";
  return editorial >= 400 ? "article" : "detail";
}

/** Tipo mayoritario; en empate gana el de mejor posición promedio. */
export function majorityType(items: { type: PageType; position: number }[]): PageType {
  const agg = new Map<PageType, { n: number; pos: number }>();
  for (const i of items) {
    const a = agg.get(i.type) ?? { n: 0, pos: 0 };
    agg.set(i.type, { n: a.n + 1, pos: a.pos + i.position });
  }
  return [...agg.entries()].sort((a, b) => b[1].n - a[1].n || a[1].pos / a[1].n - b[1].pos / b[1].n)[0]?.[0] ?? "article";
}

/** Comunas y ciudades de Chile (para detectar keywords locales), sin tildes. */
const PLACE_NAMES = [
  ...new Set(
    `santiago|providencia|las condes|vitacura|lo barnechea|nunoa|la reina|macul|penalolen|la florida|puente alto|san miguel|san joaquin|la cisterna|el bosque|la granja|la pintana|san bernardo|maipu|cerrillos|estacion central|quinta normal|lo prado|pudahuel|cerro navia|renca|quilicura|huechuraba|conchali|recoleta|independencia|colina|lampa|buin|talagante|melipilla|penaflor|padre hurtado|pirque|lo espejo|pedro aguirre cerda|san ramon|valparaiso|vina del mar|concon|quilpue|villa alemana|san antonio|rancagua|talca|chillan|concepcion|talcahuano|los angeles|temuco|valdivia|osorno|puerto montt|punta arenas|antofagasta|calama|iquique|arica|la serena|coquimbo|copiapo|curico|linares|pucon|puerto varas|coyhaique`.split("|")
  ),
];
/** Ubicación mencionada en la keyword ("masajes las condes" → "Las Condes"), o null. */
export function detectLocation(keyword: string): string | null {
  const k = ` ${strip(keyword).replace(/[^a-z0-9ñ ]/g, " ").replace(/\s+/g, " ").trim()} `;
  const hit = PLACE_NAMES.filter((p) => k.includes(` ${p} `)).sort((a, b) => b.length - a.length)[0];
  if (!hit) return null;
  // recuperar las palabras originales (con tildes/ñ) y capitalizar
  const orig = keyword.trim().split(/\s+/);
  const want = hit.split(" ");
  for (let i = 0; i + want.length <= orig.length; i++) {
    const slice = orig.slice(i, i + want.length);
    if (slice.every((w, j) => strip(w).replace(/[^a-z0-9ñ]/g, "") === want[j])) return slice.map(capWord).join(" ");
  }
  return want.map(capWord).join(" ");
}

const capWord = (w: string, i: number) => (i > 0 && /^(de|del)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

/** Adjetivos genéricos que no aportan en un title. */
const GENERIC_ADJ = /(?<!\p{L})(únic[oa]s?|unic[oa]s?|increíbles?|increibles?|espectaculares?|asombros[oa]s?|impresionantes?|fantástic[oa]s?|fantastic[oa]s?|maravillos[oa]s?|inigualables?|insuperables?|de ensueño|sin igual|imperdibles?)(?!\p{L})/giu;

/** Title final: sin adjetivos genéricos, con la ubicación si la keyword es local y la marca al final. */
export function polishTitle(title: string, brand: string, location: string | null): string {
  let t = title.replace(GENERIC_ADJ, "").replace(/\s{2,}/g, " ").replace(/\s+([,:|·-])/g, "$1").replace(/^[\s,:|·-]+|[\s,:·-]+$/g, "").trim();
  // quitar una marca puesta en otro lugar para dejarla al final
  const brandRe = new RegExp(`\\s*[|·–-]?\\s*${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[|·–-]?\\s*`, "i");
  t = t.replace(brandRe, " ").trim().replace(/^[\s,:|·-]+/, "");
  // conectores que quedan colgando al sacar adjetivos ("Masajes únicos e increíbles" → "Masajes")
  t = t.replace(/(\s+(y|e|o|u|de|con|para|muy|más|mas))+$/i, "").replace(/\s+(y|e)\s+(en|de)\s/gi, " $2 ").trim();
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (location && !strip(t).includes(strip(location))) t = `${t} en ${location}`;
  return `${t} | ${brand}`;
}

export function brandOf(project: { domain: string; name?: string; settings?: unknown }): string {
  const brands = ((project.settings ?? {}) as { brands?: string[] }).brands;
  const raw = brands?.[0] ?? project.domain.replace(/^www\./, "").split(".")[0];
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * Quita del title la parte que se repite en todas las páginas del dominio ("Mystery | Books to Scrape" → "Mystery"):
 * es la marca/sufijo del sitio, no un término del contenido.
 */
export function cleanTitle(title: string | null, siblingTitles: (string | null)[]): string {
  if (!title) return "";
  const parts = (t: string) => t.split(/\s+[|·–—-]\s+/).map((x) => x.trim()).filter(Boolean);
  const mine = parts(title);
  const others = siblingTitles.filter((t): t is string => Boolean(t)).map(parts);
  if (!others.length || mine.length < 2) return title;
  const common = mine.filter((seg) => others.every((o) => o.includes(seg)));
  const kept = mine.filter((seg) => !common.includes(seg));
  return (kept.length ? kept : mine).join(" ");
}
