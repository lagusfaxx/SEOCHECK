import { fieldCls } from "./web-vitals";
/** Reglas del informe: puntaje de impacto, falsos positivos, variantes ortográficas, PageSpeed lab vs campo. */
import { strip } from "./text";

/** Versión de las reglas del informe: queda escrita en cada informe para saber con qué criterio se generó. */
export const RULES_VERSION = "2026.10.16";

/** Distancia de edición (con transposición), cortando apenas supera `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = new Array(b.length + 1).fill(0);
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

const simple = (s: string) => strip(s).replace(/[^a-z0-9ñ ]/g, " ").replace(/\s+/g, " ").trim();

/** Marca a partir del dominio: "uzeed.cl" → "uzeed". */
export const brandFromDomain = (domain: string) => simple(domain.replace(/^www\./, "").split(".")[0]).replace(/ /g, "");

/** Consulta de marca: contiene el nombre del dominio o una variante a ≤ 2 ediciones ("uzed", "useed", "u zeed"). */
export function isBrandQuery(query: string, brand: string): boolean {
  const q = simple(query);
  if (!brand || brand.length < 3) return false;
  if (q.replace(/ /g, "").includes(brand)) return true;
  const max = brand.length <= 4 ? 1 : 2;
  const words = q.split(" ");
  // palabras sueltas y pares unidos ("u zeed" → "uzeed")
  const cands = [...words, ...words.slice(1).map((w, i) => words[i] + w)];
  return cands.some((w) => w.length >= brand.length - max && editDistance(w, brand, max) <= max);
}

/** Canonical de una URL con parámetros hacia la misma URL sin parámetros: intencional. */
export function isParamCanonical(url: string, canonical: string | null | undefined): boolean {
  if (!canonical) return false;
  try {
    const u = new URL(url), c = new URL(canonical);
    if (!u.search) return false;
    const path = (x: URL) => x.pathname.replace(/\/+$/, "") || "/";
    return u.hostname.replace(/^www\./, "") === c.hostname.replace(/^www\./, "") && path(u) === path(c) && !c.search;
  } catch {
    return false;
  }
}

/** Rutas privadas que es normal bloquear en robots.txt. */
export const PRIVATE_PATH = /\/(login|logout|signin|sign-in|signup|sign-up|ingresar|iniciar-sesion|registro|registrarse|register|cuenta|mi-cuenta|my-account|account|perfil\/editar|panel|dashboard|admin|wp-admin|carrito|carro|cart|checkout|pago|pagar|payment|pedido|orders?)(\/|$|\?)/i;

/**
 * Ancho aproximado en px de un texto en el resultado de Google (Arial). Es una estimación: el corte real depende
 * del dispositivo y Google puede reescribir title y descripción, así que solo sirve para avisar, no como regla.
 */
export function serpWidthPx(text: string, fontPx: number): number {
  let em = 0;
  for (const ch of text) {
    if (/[ijlI.,:;!|'’`ftr ]/.test(ch)) em += 0.3;
    else if (/[mwMW@%]/.test(ch)) em += 0.85;
    else if (/[A-ZÁÉÍÓÚÑ]/.test(ch)) em += 0.68;
    else if (/[0-9]/.test(ch)) em += 0.56;
    else em += 0.52;
  }
  return Math.round(em * fontPx);
}
/** Ancho visible típico en escritorio: title ~600 px a 20 px; descripción ~2 líneas (~920 px) a 14 px. */
export const TITLE_MAX_PX = 600;
export const META_MAX_PX = 920;

/** CTR esperado (curva aproximada de la industria) para la posición. */
export function expectedCtrAt(pos: number) {
  const t = [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
  return t[Math.max(0, Math.min(9, Math.round(pos) - 1))] ?? 0.01;
}

export type QueryRow = { query: string; impressions: number; clicks: number; position: number };

/**
 * Variantes ortográficas que traen tráfico a la misma página: consultas que difieren en 1–2 caracteres
 * ("peñalolen" / "penalolen", "masage" / "masaje"). Devuelve grupos con la forma principal y sus variantes.
 */
export function spellingVariants(rows: QueryRow[], minShare = 0.1, minImpr = 20) {
  const sorted = [...rows].filter((r) => r.query.length >= 4).sort((a, b) => b.impressions - a.impressions).slice(0, 300);
  const used = new Set<string>();
  const groups: { main: QueryRow; variants: QueryRow[] }[] = [];
  for (const main of sorted) {
    if (used.has(main.query)) continue;
    const variants: QueryRow[] = [];
    for (const v of sorted) {
      if (v === main || used.has(v.query)) continue;
      if (v.impressions < minImpr && v.impressions < main.impressions * minShare) continue;
      const d = editDistance(main.query, v.query, 2);
      if (d >= 1 && d <= 2 && simple(main.query).split(" ").length === simple(v.query).split(" ").length) variants.push(v);
    }
    if (variants.length) {
      used.add(main.query);
      variants.forEach((v) => used.add(v.query));
      groups.push({ main, variants });
    }
  }
  return groups;
}

type Metric = { p75: number; cat: string | null } | null;
export type PsiField = { clsUnit?: "ratio" | "hundredths"; lcp?: Metric; inp?: Metric; cls?: Metric; source?: "url" | "origin" | null } | null;

/** PageSpeed: prioriza datos de campo y marca cuando el laboratorio no se parece a lo que viven los usuarios. */
export function psiVerdict(score: number | null, lab: { lcp?: number | null } | null, field: PsiField) {
  const fLcp = field?.lcp?.p75 ?? null;
  const metrics = [fLcp, field?.inp?.p75 ?? null, fieldCls(field)];
  const valid = (n: number | null) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  const hasField = Boolean(field?.source && metrics.some(valid));
  const fieldComplete = Boolean(field?.source && metrics.every(valid));
  const fieldBad = hasField && ((fLcp ?? 0) > 2500 || (field?.inp?.p75 ?? 0) > 200 || (fieldCls(field) ?? 0) > 0.1);
  const discrepancy = Boolean(fLcp && lab?.lcp && lab.lcp > 3 * fLcp);
  return {
    hasField,
    fieldComplete,
    fieldBad,
    discrepancy,
    /** Hay que revisar: campo fuera de rango, o campo incompleto y laboratorio < 50. */
    actionable: fieldBad || (!fieldComplete && score != null && score < 50),
  };
}

export const DISCREPANCY_HINT =
  "El LCP de laboratorio es más de 3× el de usuarios reales: suele ser un interstitial o modal (verificación de edad, cookies) que Lighthouse toma como el elemento más grande, un bloqueo a Lighthouse (WAF/bot), o una imagen hero que solo carga pesada en la simulación. Revisar eso antes de optimizar a ciegas.";

/** Severidad y facilidad (1 = cambio de plantilla rápido) por tipo de issue. */
export const SEV_WEIGHT: Record<string, number> = { critical: 3, warning: 2, info: 1 };
export const EASE: Record<string, number> = {
  title_missing: 1, title_long: 1, title_short: 1, title_dup: 0.9, meta_missing: 1, meta_long: 1, meta_short: 1, meta_dup: 0.9,
  h1_missing: 1, h1_multiple: 1, canonical_missing: 1, canonical_other: 0.9, canonical_bad_target: 0.9, jsonld_mismatch: 0.8, js_dependent: 0.5, jsonld_invalid: 0.9, img_no_alt: 0.9, hreflang_no_self: 0.9,
  robots_missing: 1, sitemap_missing: 1, noindex_in_sitemap: 1, blocked_robots: 0.9, noindex: 0.9, nofollow: 0.9, redirect: 0.9,
  broken_link: 0.8, redirect_chain: 0.8, redirect_loop: 0.8, canonical_loop: 0.9, robots_conflict: 0.9, render_mismatch: 0.5, http_4xx: 0.7, http_5xx: 0.6, fetch_failed: 0.6, blocked_by_waf: 0.7,
  orphan: 0.6, no_inlinks: 0.6, deep_page: 0.5, slow: 0.5, thin_content: 0.4, dup_content: 0.4,
};
export const EASE_LABEL = (e: number) => (e >= 0.9 ? "fácil" : e >= 0.6 ? "media" : "difícil");

/** Issues on-page menores (cosméticos): pesan la mitad que un problema estructural con el mismo tráfico. */
export const MINOR_ONPAGE = new Set(["title_long", "title_short", "title_dup", "meta_missing", "meta_long", "meta_short", "meta_dup", "h1_multiple", "img_no_alt", "canonical_missing", "hreflang_no_self", "jsonld_invalid", "deep_page", "slow", "thin_content"]);

export type Task = {
  /** issue on-page menor: su impacto pesa la mitad (MINOR_FACTOR) */
  minor?: boolean;
  title: string;
  fix: string;
  /** impresiones afectadas (o peso de plantilla sin GSC) */
  traffic: number;
  trafficLabel: string;
  sev: number;
  sevLabel: string;
  ease: number;
  score: number;
  detail?: string[];
  /** qué tan seguro es que el problema exista y tenga ese impacto */
  confidence?: Confidence;
  /** en qué se basa la confianza */
  evidence?: string;
  /** qué se rompe si se aplica mal */
  risk?: string;
  /** qué debe cambiar y qué debe conservarse */
  verify?: string;
};

export type Confidence = "alta" | "media" | "baja";
/** La confianza entra al puntaje: una hipótesis no compite de igual a igual con un error comprobado. */
export const CONFIDENCE_FACTOR: Record<Confidence, number> = { alta: 1, media: 0.8, baja: 0.6 };

export const MINOR_FACTOR = 0.5;
export function makeTask(t: Omit<Task, "score">): Task {
  const conf = CONFIDENCE_FACTOR[t.confidence ?? "media"];
  return { ...t, score: Math.round(t.traffic * t.sev * t.ease * conf * (t.minor ? MINOR_FACTOR : 1) * 10) / 10 };
}

/** Cambios que pueden sacar páginas de Google si se aplican mal. */
export const ISSUE_RISK: Record<string, string> = {
  canonical_other: "cambiar un canonical intencional puede dividir señales entre variantes",
  canonical_bad_target: "apuntar el canonical a una URL equivocada puede desindexar esta página",
  noindex: "quitar o poner noindex cambia qué URLs aparecen en Google",
  noindex_in_sitemap: "quitar el noindex equivocado expone filtros o páginas privadas",
  blocked_robots: "abrir robots.txt puede exponer carrito, cuenta o búsquedas",
  redirect: "un 301 mal apuntado pierde la página original",
  redirect_chain: "un 301 mal apuntado pierde la página original",
  http_4xx: "redirigir todo a la home se trata como soft 404; redirigir solo a equivalentes reales",
  nofollow: "quitar el noindex de filtros puede indexar combinaciones sin valor",
  canonical_loop: "elegir la versión principal equivocada puede sacar de Google la página que vende",
  robots_conflict: "quitar la directiva equivocada puede indexar páginas privadas o desindexar páginas con tráfico",
};

/**
 * Orden final: solo por impacto. Antes los on-page menores iban siempre al final, y un title de la home con mucho
 * tráfico quedaba detrás de tareas casi sin impacto; ahora pesan la mitad (ya incluido en score) y compiten por impacto.
 */
export const byPriority = (a: Task, b: Task) => b.score - a.score || Number(Boolean(a.minor)) - Number(Boolean(b.minor));

/** Menos de esto en 28 días: las cifras de Search Console son orientativas. */
export const LOW_GSC_IMPRESSIONS = 1000;
/** Variación en % solo con una base mínima; con menos se muestran los valores absolutos. */
export const MIN_TREND_BASE = 30;
