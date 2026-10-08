/** Reglas del informe: puntaje de impacto, falsos positivos, variantes ortográficas, PageSpeed lab vs campo. */
import { strip } from "./text";

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
export type PsiField = { lcp?: Metric; inp?: Metric; cls?: Metric; source?: "url" | "origin" | null } | null;

/** PageSpeed: prioriza datos de campo y marca cuando el laboratorio no se parece a lo que viven los usuarios. */
export function psiVerdict(score: number | null, lab: { lcp?: number | null } | null, field: PsiField) {
  const fLcp = field?.lcp?.p75 ?? null;
  const hasField = Boolean(field?.source && (field?.lcp || field?.inp || field?.cls));
  const fieldBad = hasField && ((fLcp ?? 0) > 2500 || (field?.inp?.p75 ?? 0) > 200 || (field?.cls?.p75 ?? 0) > 0.1);
  const discrepancy = Boolean(fLcp && lab?.lcp && lab.lcp > 3 * fLcp);
  return {
    hasField,
    fieldBad,
    discrepancy,
    /** hay que actuar: campo malo, o sin campo y laboratorio < 50 */
    actionable: fieldBad || (!hasField && score != null && score < 50),
  };
}

export const DISCREPANCY_HINT =
  "El LCP de laboratorio es más de 3× el de usuarios reales: suele ser un interstitial o modal (verificación de edad, cookies) que Lighthouse toma como el elemento más grande, un bloqueo a Lighthouse (WAF/bot), o una imagen hero que solo carga pesada en la simulación. Revisar eso antes de optimizar a ciegas.";

/** Severidad y facilidad (1 = cambio de plantilla rápido) por tipo de issue. */
export const SEV_WEIGHT: Record<string, number> = { critical: 3, warning: 2, info: 1 };
export const EASE: Record<string, number> = {
  title_missing: 1, title_long: 1, title_short: 1, title_dup: 0.9, meta_missing: 1, meta_long: 1, meta_short: 1, meta_dup: 0.9,
  h1_missing: 1, h1_multiple: 1, canonical_missing: 1, canonical_other: 0.9, jsonld_invalid: 0.9, img_no_alt: 0.9, hreflang_no_self: 0.9,
  robots_missing: 1, sitemap_missing: 1, noindex_in_sitemap: 1, blocked_robots: 0.9, noindex: 0.9, redirect: 0.9,
  broken_link: 0.8, redirect_chain: 0.8, http_4xx: 0.7, http_5xx: 0.6, fetch_failed: 0.6, blocked_by_waf: 0.7,
  orphan: 0.6, no_inlinks: 0.6, deep_page: 0.5, slow: 0.5, thin_content: 0.4, dup_content: 0.4,
};
export const EASE_LABEL = (e: number) => (e >= 0.9 ? "fácil" : e >= 0.6 ? "media" : "difícil");

/** Issues on-page menores (cosméticos): se ordenan después de las oportunidades, velocidad y problemas estructurales. */
export const MINOR_ONPAGE = new Set(["title_long", "title_short", "title_dup", "meta_missing", "meta_long", "meta_short", "meta_dup", "h1_multiple", "img_no_alt", "canonical_missing", "hreflang_no_self", "jsonld_invalid", "deep_page", "slow", "thin_content"]);

export type Task = {
  /** issue on-page menor: va después del resto aunque su impacto sea mayor */
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
};

export function makeTask(t: Omit<Task, "score">): Task {
  return { ...t, score: Math.round(t.traffic * t.sev * t.ease * 10) / 10 };
}

/** Orden final: primero lo importante por impacto, después los issues on-page menores por impacto. */
export const byPriority = (a: Task, b: Task) => Number(Boolean(a.minor)) - Number(Boolean(b.minor)) || b.score - a.score;
