import { JWT } from "google-auth-library";
import { env } from "../env";
import { fetchT } from "../util";

/**
 * Propiedad de Search Console: `sc-domain:dominio.cl` (propiedad de dominio) o
 * `https://dominio.cl/` (prefijo de URL, con slash final). Lanza un error claro si no calza.
 */
export function normalizeGscProperty(input: string): string {
  const v = input.trim();
  const dom = v.match(/^sc-domain:\s*(?:https?:\/\/)?([^/\s]+)\/?$/i);
  if (dom) return `sc-domain:${dom[1].toLowerCase()}`;
  if (/^https?:\/\//i.test(v)) {
    const u = new URL(v);
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`}`;
  }
  // dominio pelado ("uzeed.cl") o variantes mal escritas ("sc-uzeed.cl", "sc domain uzeed.cl") → propiedad de dominio
  const bare = v.replace(/^sc(?:[-_ ]domain)?[-_:\s]+/i, "").replace(/^www\./i, "").replace(/\/$/, "");
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(bare)) return `sc-domain:${bare.toLowerCase()}`;
  throw new Error(`Propiedad GSC inválida "${input}": usa sc-domain:dominio.cl (propiedad de dominio) o https://dominio.cl/ (prefijo de URL)`);
}

/**
 * Lee GSC_SERVICE_ACCOUNT_JSON tolerando cómo queda al pegarlo en un panel: JSON tal cual, en base64,
 * entre comillas, o con los saltos de línea de la private_key convertidos en saltos reales.
 */
export function parseServiceAccount(input: string): { client_email: string; private_key: string } {
  let raw = input
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^'([\s\S]*)'$/, "$1");
  if (!/^[{"\\]/.test(raw)) raw = Buffer.from(raw, "base64").toString("utf8").trim();
  // reparaciones para lo que suele pasar al copiar/pegar en un panel, de menos a más invasiva
  const fixes: ((s: string) => string)[] = [
    (s) => s,
    // espacios "raros" (no-break, de ancho cero) y comillas tipográficas que vienen de copiar desde una web o un editor
    (s) => s.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ").replace(/[\u201C\u201D]/g, '"'),
    // comillas escapadas por el panel: {\"type\": ...}
    (s) => s.replace(/^"([\s\S]*)"$/, "$1").replace(/\\"/g, '"'),
  ];
  let j: any;
  let fixed = raw;
  for (let i = 0; i < fixes.length && j === undefined; i++) {
    fixed = fixes[i](fixed);
    for (const cand of [fixed, fixed.replace(/\r?\n/g, "\\n")]) {
      try {
        j = JSON.parse(cand);
        break;
      } catch {}
    }
  }
  if (j === undefined) {
    const hint = `(${raw.length} caracteres, empieza con ${JSON.stringify(raw.slice(0, 12))}${raw.includes("BEGIN PRIVATE KEY") ? ", tiene la clave" : ", sin la clave privada: ¿quedó cortado?"})`;
    throw new Error(`GSC_SERVICE_ACCOUNT_JSON no es un JSON válido ${hint}. Lo más seguro: pegarlo en base64 (ver README).`);
  }
  // venía como string JSON (doble serializado): repetir con su contenido
  if (typeof j === "string") return parseServiceAccount(j);
  if (!j?.client_email || !j?.private_key) throw new Error("GSC_SERVICE_ACCOUNT_JSON no tiene client_email/private_key: ¿es el JSON de una cuenta de servicio?");
  return { client_email: j.client_email, private_key: String(j.private_key).replace(/\\n/g, "\n") };
}

export function serviceAccountEmail(): string | null {
  try {
    return parseServiceAccount(env.gscCredentials).client_email;
  } catch {
    return null;
  }
}

/** Traduce errores de la API de GSC a mensajes accionables. */
export function gscError(e: any, site: string): Error {
  const status = e?.response?.status ?? e?.status ?? e?.code;
  const apiMsg = e?.response?.data?.error?.message ?? e?.message ?? String(e);
  const email = serviceAccountEmail() ?? "la service account";
  if (status === 403)
    return new Error(`Sin acceso a ${site}: agrega ${email} como usuario (permiso Completo) en Search Console → Configuración → Usuarios y permisos. Detalle: ${apiMsg}`);
  if (status === 404) return new Error(`La propiedad ${site} no existe en Search Console o está mal escrita (sc-domain:dominio.cl o https://dominio.cl/). Detalle: ${apiMsg}`);
  if (status === 400) return new Error(`GSC rechazó la consulta para ${site}: ${apiMsg}`);
  if (status === 401) return new Error(`Credenciales de GSC inválidas (GSC_SERVICE_ACCOUNT_JSON): ${apiMsg}`);
  return new Error(`GSC ${status ?? ""}: ${apiMsg}`);
}

let jwt: JWT | null = null;
function client() {
  if (!env.gscCredentials) throw new Error("Falta GSC_SERVICE_ACCOUNT_JSON");
  if (!jwt) {
    const creds = parseServiceAccount(env.gscCredentials);
    jwt = new JWT({ email: creds.client_email, key: creds.private_key, scopes: ["https://www.googleapis.com/auth/webmasters.readonly"] });
  }
  return jwt;
}

/** Propiedades de Search Console a las que tiene acceso la cuenta de servicio. */
export async function gscSites(): Promise<string[]> {
  const res = await client().request<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>({ url: "https://searchconsole.googleapis.com/webmasters/v3/sites" });
  return (res.data.siteEntry ?? []).filter((x) => x.permissionLevel !== "siteUnverifiedUser").map((x) => x.siteUrl);
}

const hostOfProp = (p: string) => p.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();

/**
 * Elige, entre las propiedades accesibles, la que corresponde a lo que escribió el usuario:
 * la exacta si existe; si no, otra del mismo dominio (dominio > https > https://www > http).
 */
export function matchGscProperty(input: string, sites: string[]): string | null {
  const want = normalizeGscProperty(input);
  if (sites.includes(want)) return want;
  const host = hostOfProp(want);
  const same = sites.filter((s) => hostOfProp(s) === host);
  const rank = (s: string) => (s.startsWith("sc-domain:") ? 0 : s.startsWith(`https://${host}`) ? 1 : s.startsWith("https://") ? 2 : 3);
  return same.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** Normaliza y, si hay credenciales, corrige al formato real de la propiedad en Search Console. */
export async function resolveGscProperty(input: string): Promise<string> {
  const norm = normalizeGscProperty(input);
  if (!env.gscCredentials) return norm;
  try {
    return matchGscProperty(norm, await gscSites()) ?? norm;
  } catch {
    return norm;
  }
}

/** Agrega al error qué propiedades sí ve la cuenta (lo más útil cuando hay un 403/404). */
async function withSitesHint(err: Error, prop: string): Promise<Error> {
  try {
    const sites = await gscSites();
    const alt = matchGscProperty(prop, sites);
    if (alt && alt !== prop) return new Error(`${err.message}\nLa cuenta sí tiene acceso a ${alt}: pon esa en Ajustes.`);
    return new Error(`${err.message}\nPropiedades que ve la cuenta: ${sites.length ? sites.join(", ") : "ninguna"}.`);
  } catch {
    return err;
  }
}

export type GscApiRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };

export async function gscQuery(site: string, body: Record<string, unknown>): Promise<GscApiRow[]> {
  const prop = normalizeGscProperty(site);
  try {
    const res = await client().request<{ rows?: GscApiRow[] }>({
      url: `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(prop)}/searchAnalytics/query`,
      method: "POST",
      data: body,
    });
    return res.data.rows ?? [];
  } catch (e) {
    const err = gscError(e, prop);
    const status = (e as any)?.response?.status ?? (e as any)?.status;
    throw status === 403 || status === 404 ? await withSitesHint(err, prop) : err;
  }
}

export async function urlInspect(site: string, url: string, languageCode = "es-CL") {
  const prop = normalizeGscProperty(site);
  try {
    const res = await client().request<any>({
      url: "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
      method: "POST",
      data: { inspectionUrl: url, siteUrl: prop, languageCode },
    });
    return res.data.inspectionResult;
  } catch (e) {
    throw gscError(e, prop);
  }
}

export async function pageSpeed(url: string, strategy: "mobile" | "desktop") {
  const p = new URLSearchParams({ url, strategy, category: "performance" });
  if (env.psiKey) p.set("key", env.psiKey);
  const res = await fetchT(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${p}`, { timeoutMs: 120000 });
  if (res.status === 429) throw new Error(`PSI 429: cuota agotada${env.psiKey ? "" : " (sin PAGESPEED_API_KEY la cuota anónima es mínima)"}`);
  if (!res.ok) throw new Error(`PSI ${res.status}`);
  return parsePsi(await res.json());
}

/** Lab (Lighthouse) + campo (CrUX). Métricas de campo ausentes quedan en null, nunca en 0. */
export function parsePsi(j: any) {
  const a = j.lighthouseResult?.audits ?? {};
  const lab = {
    lcp: a["largest-contentful-paint"]?.numericValue ?? null,
    cls: a["cumulative-layout-shift"]?.numericValue ?? null,
    tbt: a["total-blocking-time"]?.numericValue ?? null,
    fcp: a["first-contentful-paint"]?.numericValue ?? null,
    si: a["speed-index"]?.numericValue ?? null,
    ttfb: a["server-response-time"]?.numericValue ?? null,
  };
  // CrUX: datos de la URL, del origen (origin_fallback) o ninguno.
  const le = j.loadingExperience ?? {};
  const m = le.metrics ?? {};
  const f = (k: string) => (m[k] && typeof m[k].percentile === "number" ? { p75: m[k].percentile, cat: m[k].category ?? null } : null);
  const fieldSource: "url" | "origin" | null = Object.keys(m).length ? (le.origin_fallback ? "origin" : "url") : null;
  const field = {
    lcp: f("LARGEST_CONTENTFUL_PAINT_MS"),
    inp: f("INTERACTION_TO_NEXT_PAINT"),
    cls: f("CUMULATIVE_LAYOUT_SHIFT_SCORE"),
    fcp: f("FIRST_CONTENTFUL_PAINT_MS"),
    ttfb: f("EXPERIMENTAL_TIME_TO_FIRST_BYTE"),
    overall: le.overall_category ?? null,
    source: fieldSource,
  };
  const score = j.lighthouseResult?.categories?.performance?.score;
  return { lab, field, score: score != null ? Math.round(score * 100) : null };
}

export async function indexNow(host: string, urls: string[]) {
  if (!env.indexNowKey) throw new Error("Falta INDEXNOW_KEY");
  const res = await fetchT("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host, key: env.indexNowKey, keyLocation: `https://${host}/${env.indexNowKey}.txt`, urlList: urls.slice(0, 10000) }),
  });
  return res.status;
}
