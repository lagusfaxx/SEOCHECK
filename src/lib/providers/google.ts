import { JWT } from "google-auth-library";
import { env } from "../env";
import { fetchT } from "../util";

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
  const res = await client().request<{ rows?: GscApiRow[] }>({
    url: `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
    method: "POST",
    data: body,
  });
  return res.data.rows ?? [];
}

export async function urlInspect(site: string, url: string, languageCode = "es-CL") {
  const res = await client().request<any>({
    url: "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
    method: "POST",
    data: { inspectionUrl: url, siteUrl: site, languageCode },
  });
  return res.data.inspectionResult;
}

export async function pageSpeed(url: string, strategy: "mobile" | "desktop") {
  const p = new URLSearchParams({ url, strategy, category: "performance" });
  if (env.psiKey) p.set("key", env.psiKey);
  const res = await fetchT(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${p}`, { timeoutMs: 120000 });
  if (!res.ok) throw new Error(`PSI ${res.status}`);
  const j: any = await res.json();
  const a = j.lighthouseResult?.audits ?? {};
  const lab = {
    lcp: a["largest-contentful-paint"]?.numericValue,
    cls: a["cumulative-layout-shift"]?.numericValue,
    tbt: a["total-blocking-time"]?.numericValue,
    fcp: a["first-contentful-paint"]?.numericValue,
    si: a["speed-index"]?.numericValue,
    ttfb: a["server-response-time"]?.numericValue,
  };
  const m = j.loadingExperience?.metrics ?? {};
  const f = (k: string) => (m[k] ? { p75: m[k].percentile, cat: m[k].category } : null);
  const field = {
    lcp: f("LARGEST_CONTENTFUL_PAINT_MS"),
    inp: f("INTERACTION_TO_NEXT_PAINT"),
    cls: f("CUMULATIVE_LAYOUT_SHIFT_SCORE"),
    fcp: f("FIRST_CONTENTFUL_PAINT_MS"),
    ttfb: f("EXPERIMENTAL_TIME_TO_FIRST_BYTE"),
    overall: j.loadingExperience?.overall_category ?? null,
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
