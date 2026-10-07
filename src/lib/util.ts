export function normDomain(d: string) {
  return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

export function hostOf(u: string) {
  try {
    return normDomain(new URL(u).hostname);
  } catch {
    return normDomain(u);
  }
}

export function normUrl(u: string, base?: string): string | null {
  try {
    const url = new URL(u, base);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function normTerm(t: string) {
  return t.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function fetchT(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20000);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TRACKING_PARAMS = /^(utm_.*|gclid|gclsrc|dclid|fbclid|msclkid|yclid|mc_cid|mc_eid|_ga|_gl)$/i;

/**
 * Clave canónica para comparar URLs de SERP: host en minúsculas sin `www.`, sin esquema
 * (http ≡ https), sin puerto por defecto, sin fragment, sin trailing slash y sin parámetros
 * de tracking; el resto de parámetros queda ordenado.
 */
export function urlKey(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    const port = u.port && !["80", "443"].includes(u.port) ? `:${u.port}` : "";
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k)).sort(([a, x], [b, y]) => a.localeCompare(b) || x.localeCompare(y));
    const qs = params.length ? `?${new URLSearchParams(params).toString()}` : "";
    const path = u.pathname.replace(/\/+$/, "");
    return `${host}${port}${path}${qs}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}
