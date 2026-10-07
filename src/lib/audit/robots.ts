import { env } from "../env";
import { fetchT } from "../util";

export type Robots = { disallow: string[]; allow: string[]; sitemaps: string[] };

/** Reglas del grupo `*` (o del grupo que coincide con nuestro bot). */
export function parseRobots(txt: string): Robots {
  const out: Robots = { disallow: [], allow: [], sitemaps: [] };
  let applies = false;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "sitemap") { out.sitemaps.push(val); continue; }
    if (key === "user-agent") {
      const match = val === "*" || /seocheck/i.test(val);
      applies = lastWasAgent ? applies || match : match;
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!applies) continue;
    if (key === "disallow" && val) out.disallow.push(val.replace(/\*.*$/, ""));
    if (key === "allow" && val) out.allow.push(val.replace(/\*.*$/, ""));
  }
  return out;
}

export async function fetchSitemapUrls(sitemaps: string[], max = 20000): Promise<string[]> {
  const urls = new Set<string>();
  const queue = [...sitemaps];
  const visited = new Set<string>();
  while (queue.length && urls.size < max && visited.size < 200) {
    const sm = queue.shift()!;
    if (visited.has(sm)) continue;
    visited.add(sm);
    try {
      const res = await fetchT(sm, { headers: { "User-Agent": env.userAgent }, timeoutMs: 30000 });
      if (!res.ok) continue;
      let xml: string;
      if (sm.endsWith(".gz")) {
        const { gunzipSync } = await import("node:zlib");
        xml = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");
      } else xml = await res.text();
      const isIndex = /<sitemapindex/i.test(xml);
      for (const m of xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)) {
        const loc = m[1].replace(/&amp;/g, "&");
        if (isIndex) queue.push(loc);
        else urls.add(loc);
      }
    } catch {}
  }
  return [...urls].slice(0, max);
}
