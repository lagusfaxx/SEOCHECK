import { env } from "../env";
import { fetchT, hostOf } from "../util";
import type { Serp, SerpProvider } from "./types";

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

export function parseSerpent(keyword: string, json: Any): Serp {
  const r: Any = json.results ?? json;
  const organicRaw: Any[] = r.organic ?? r.organicResults ?? [];
  const organic = organicRaw
    .map((o, i) => {
      const url = o.url ?? o.link ?? "";
      return { position: Number(o.position ?? i + 1), url, title: o.title ?? "", snippet: o.snippet, domain: hostOf(url || o.displayedUrl || "") };
    })
    .filter((o) => o.url);
  const paa = (r.peopleAlsoAsk ?? []).map((p: Any) => (typeof p === "string" ? p : p.question ?? p.title ?? "")).filter(Boolean);
  const related = (r.relatedSearches ?? []).map((p: Any) => (typeof p === "string" ? p : p.query ?? p.title ?? "")).filter(Boolean);
  const meta: Any = json.metadata ?? {};
  const features = Object.entries(FEATURE_FLAGS)
    .filter(([flag]) => meta[flag])
    .map(([, f]) => f);
  if (!meta.hasShopping && (r.shopping ?? []).length) features.push("shopping");
  return { keyword, organic, paa, related, features: [...new Set(features)], aiOverview: r.aiOverview ?? null };
}

export class SerpentProvider implements SerpProvider {
  async search(q: string, opts: { country: string; language: string; depth?: number }): Promise<Serp> {
    if (!env.serpentKey) throw new Error("Falta SERPENT_API_KEY");
    const p = new URLSearchParams({ q, country: opts.country, language: opts.language, include_aio: "true" });
    if (opts.depth && opts.depth > 10) p.set("num", String(opts.depth));
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetchT(`${env.serpentBase}/api/search?${p}`, { headers: { "X-API-Key": env.serpentKey }, timeoutMs: 60000 });
        if (res.status === 429 || res.status >= 500) throw new Error(`Serpent ${res.status}`);
        if (!res.ok) throw new Error(`Serpent ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return parseSerpent(q, await res.json());
      } catch (e) {
        last = e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw last;
  }
}
