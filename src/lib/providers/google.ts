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

export function serviceAccountEmail(): string | null {
  try {
    const raw = env.gscCredentials.trim().startsWith("{") ? env.gscCredentials : Buffer.from(env.gscCredentials, "base64").toString("utf8");
    return JSON.parse(raw).client_email ?? null;
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
    const raw = env.gscCredentials.trim().startsWith("{") ? env.gscCredentials : Buffer.from(env.gscCredentials, "base64").toString("utf8");
    const creds = JSON.parse(raw);
    jwt = new JWT({ email: creds.client_email, key: creds.private_key, scopes: ["https://www.googleapis.com/auth/webmasters.readonly"] });
  }
  return jwt;
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
    throw gscError(e, prop);
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
