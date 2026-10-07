import { env } from "../env";
import { logCost } from "../costs";
import { fetchT, hostOf } from "../util";
import type { Serp, SerpOpts, SerpProvider } from "./types";

type Any = Record<string, any>;

const FEATURE_FLAGS: Record<string, string> = {
  hasAds: "ads",
  hasRelatedSearches: "related",
  hasPeopleAlsoAsk: "paa",
  hasVideos: "videos",
  hasShopping: "shopping",
  hasFeaturedSnippet: "snippet",
  hasAiOverview: "ai_overview",
  hasKnowledgePanel: "knowledge",
  hasLocalPack: "local",
};
// Bloques de `results` → feature, para respuestas sin `metadata` (Quick).
const FEATURE_BLOCKS: Record<string, string> = {
  ads: "ads", relatedSearches: "related", peopleAlsoAsk: "paa", videos: "videos", shopping: "shopping",
  featuredSnippet: "snippet", aiOverview: "ai_overview", knowledgePanel: "knowledge", localPack: "local",
};

const present = (v: unknown) => (Array.isArray(v) ? v.length > 0 : v != null && v !== false);

export function parseSerpent(keyword: string, json: Any): Serp {
  const r: Any = json.results ?? json;
  const organicRaw: Any[] = r.organic ?? r.organicResults ?? [];
  const organic = organicRaw
    .map((o, i) => {
      const url = o.url ?? o.link ?? "";
      return { position: Number(o.position ?? i + 1), url, title: o.title ?? "", snippet: o.snippet, domain: hostOf(url || o.displayedUrl || "") };
    })
    .filter((o) => o.url);
  const paa = (r.peopleAlsoAsk ?? []).map((p: Any) => (typeof p === "string" ? p : p.question ?? p.title ?? p.query ?? "")).filter(Boolean);
  const related = (r.relatedSearches ?? []).map((p: Any) => (typeof p === "string" ? p : p.query ?? p.title ?? "")).filter(Boolean);
  const meta: Any = json.metadata ?? {};
  const features = json.metadata
    ? Object.entries(FEATURE_FLAGS).filter(([flag]) => meta[flag]).map(([, f]) => f)
    : Object.entries(FEATURE_BLOCKS).filter(([k]) => present(r[k])).map(([, f]) => f);
  if (!features.includes("shopping") && present(r.shopping)) features.push("shopping");
  return { keyword, organic, paa, related, features: [...new Set(features)], aiOverview: r.aiOverview ?? null };
}

/** Cuántas respuestas crudas se loggean por proceso (para verificar la forma real de la API). */
let rawLogsLeft = Number(process.env.SERPENT_LOG_RAW ?? 3);

export class SerpentProvider implements SerpProvider {
  private async call(path: "/api/search" | "/api/search/quick", q: string, params: Record<string, string>) {
    if (!env.serpentKey) throw new Error("Falta SERPENT_API_KEY");
    const p = new URLSearchParams({ q, ...params });
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetchT(`${env.serpentBase}${path}?${p}`, { headers: { "X-API-Key": env.serpentKey }, timeoutMs: 60000 });
        if (res.status === 429 || res.status >= 500) throw new Error(`Serpent ${res.status}`);
        const text = await res.text();
        if (!res.ok) throw Object.assign(new Error(`Serpent ${res.status}: ${text.slice(0, 200)}`), { fatal: true });
        if (rawLogsLeft > 0) {
          rawLogsLeft--;
          console.log(`[serpent raw] ${path} q=${JSON.stringify(q)} ${text.slice(0, 8000)}`);
        }
        return JSON.parse(text);
      } catch (e: any) {
        last = e;
        if (e?.fatal) break;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw last;
  }

  async deep(q: string, opts: SerpOpts): Promise<Serp> {
    // Deep cobra por página: siempre 1 página (sin num).
    const json = await this.call("/api/search", q, { country: opts.country, language: opts.language, pages: "1", include_aio: "true" });
    await logCost("serpent", "deep", 1, { projectId: opts.projectId, ref: q });
    return parseSerpent(q, json);
  }

  async quick(q: string, opts: SerpOpts & { num?: number }): Promise<Serp> {
    // Quick cobra 1 vez por llamada sin importar num.
    const num = String(Math.min(100, Math.max(10, opts.num ?? 100)));
    const json = await this.call("/api/search/quick", q, { country: opts.country, language: opts.language, num });
    await logCost("serpent", "quick", 1, { projectId: opts.projectId, ref: q });
    return parseSerpent(q, json);
  }
}
