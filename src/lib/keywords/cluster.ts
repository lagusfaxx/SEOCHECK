import type { OrganicResult } from "../providers";
import { cosine, urlKey } from "../util";

export type KwSerp = { term: string; volume: number; intent: string; urls: string[] };

/**
 * Clustering por overlap de URLs del top 10 con índice invertido URL → keywords.
 * Keywords ordenadas por volumen; cada una sin asignar es primaria y absorbe a las que
 * comparten ≥ minShared URLs con ella y tienen el mismo intent.
 */
export function overlapClusters(items: KwSerp[], minShared = 3) {
  // URLs normalizadas (y deduplicadas por keyword) antes de construir el índice
  const sorted = [...items]
    .map((k) => ({ ...k, urls: [...new Set(k.urls.map(urlKey))] }))
    .sort((a, b) => b.volume - a.volume);
  const original = new Map(items.map((k) => [k.term, k]));
  const index = new Map<string, number[]>();
  sorted.forEach((k, i) => k.urls.forEach((u) => { const l = index.get(u) ?? []; l.push(i); index.set(u, l); }));
  const assigned = new Int32Array(sorted.length).fill(-1);
  const clusters: { primary: KwSerp; members: KwSerp[] }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (assigned[i] >= 0) continue;
    const cid = clusters.length;
    assigned[i] = cid;
    const cl = { primary: original.get(sorted[i].term)!, members: [original.get(sorted[i].term)!] };
    const shared = new Map<number, number>();
    for (const u of sorted[i].urls) for (const j of index.get(u) ?? []) if (j !== i) shared.set(j, (shared.get(j) ?? 0) + 1);
    for (const [j, c] of shared) {
      if (c >= minShared && assigned[j] < 0 && sorted[j].intent === sorted[i].intent) {
        assigned[j] = cid;
        cl.members.push(original.get(sorted[j].term)!);
      }
    }
    clusters.push(cl);
  }
  return clusters;
}

/** Fallback sin SERP: greedy por volumen, absorbe keywords con coseno ≥ th y mismo intent. */
export function embeddingClusters(items: (KwSerp & { vec: number[] })[], th = 0.8) {
  const sorted = [...items].sort((a, b) => b.volume - a.volume);
  const used = new Uint8Array(sorted.length);
  const out: { primary: KwSerp; members: KwSerp[] }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const cl = { primary: sorted[i], members: [sorted[i]] as KwSerp[] };
    for (let j = i + 1; j < sorted.length; j++) {
      if (!used[j] && sorted[j].intent === sorted[i].intent && cosine(sorted[i].vec, sorted[j].vec) >= th) {
        used[j] = 1;
        cl.members.push(sorted[j]);
      }
    }
    out.push(cl);
  }
  return out;
}

export const STRONG_DOMAINS = [
  "wikipedia.org", "youtube.com", "mercadolibre.cl", "falabella.com", "paris.cl", "ripley.cl", "lider.cl", "sodimac.cl",
  "amazon.com", "facebook.com", "instagram.com", "linkedin.com", "reddit.com", "gob.cl", "emol.com", "latercera.com",
  "biobiochile.cl", "cooperativa.cl", "biobio.cl", "pinterest.com", "tiktok.com", "x.com", "twitter.com", "quora.com",
  "infobae.com", "elmostrador.cl", "chileatiende.gob.cl", "bcentral.cl", "uc.cl", "uchile.cl", "yapo.cl", "portalinmobiliario.com",
];

export function isStrong(domain: string, extra: string[] = []) {
  return [...STRONG_DOMAINS, ...extra].some((s) => domain === s || domain.endsWith("." + s) || (s.startsWith(".") && domain.endsWith(s))) || /\.gob\.cl$|\.gov$|\.edu$/.test(domain);
}

/** 0–100. Sube con dominios fuertes en el top 10 y con poca diversidad de dominios. */
export function difficultyProxy(organic: OrganicResult[], extraStrong: string[] = []) {
  const top = organic.slice(0, 10);
  if (!top.length) return 50;
  const strong = top.filter((o) => isStrong(o.domain, extraStrong)).length;
  const diversity = new Set(top.map((o) => o.domain)).size / top.length;
  return Math.round(Math.min(100, Math.max(5, 10 + 65 * (strong / top.length) + 25 * (1 - diversity))));
}

export function kwScore(volume: number, relevance: number, difficulty: number) {
  return Math.round(((volume || 0) * Math.max(0, relevance)) / Math.max(0.05, difficulty / 100));
}
