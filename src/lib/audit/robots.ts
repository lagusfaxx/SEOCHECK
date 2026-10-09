import { env } from "../env";
import { safeFetch } from "../net/ssrf";

export type Robots = {
  /** reglas del grupo que aplica (Googlebot si existe, si no `*`), tal cual vienen (con comodines) */
  disallow: string[];
  allow: string[];
  sitemaps: string[];
  /** a qué grupo corresponden las reglas */
  group: string;
};

/**
 * robots.txt según el estándar (RFC 9309) y como lo aplica Google: se usa el grupo más específico para el bot
 * (Googlebot si existe, si no `*`; los grupos NO se mezclan), comodines `*` y `$`, y gana la regla más larga
 * (en empate, Allow).
 */
export function parseRobots(txt: string, bot = "googlebot"): Robots {
  type Group = { agents: string[]; allow: string[]; disallow: string[] };
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of txt.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "sitemap") {
      if (val) sitemaps.push(val);
      continue;
    }
    if (key === "user-agent") {
      if (!lastWasAgent || !cur) {
        cur = { agents: [], allow: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "disallow" && val) cur.disallow.push(val);
    if (key === "allow" && val) cur.allow.push(val);
  }
  // grupo más específico: el token de agente más largo contenido en el nombre del bot; si no, "*"
  const b = bot.toLowerCase();
  let best: Group | null = null;
  let bestLen = -1;
  for (const g of groups)
    for (const a of g.agents) {
      if (a !== "*" && b.includes(a) && a.length > bestLen) {
        best = g;
        bestLen = a.length;
      }
    }
  const star = groups.filter((g) => g.agents.includes("*"));
  const chosen = best ? [best] : star;
  return {
    disallow: chosen.flatMap((g) => g.disallow),
    allow: chosen.flatMap((g) => g.allow),
    sitemaps,
    group: best ? best.agents.join(",") : star.length ? "*" : "",
  };
}

const ruleCache = new Map<string, RegExp>();
function ruleRe(rule: string) {
  let re = ruleCache.get(rule);
  if (!re) {
    const anchored = rule.endsWith("$");
    const body = (anchored ? rule.slice(0, -1) : rule)
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    re = new RegExp(`^${body}${anchored ? "$" : ""}`);
    ruleCache.set(rule, re);
  }
  return re;
}

/** ¿Googlebot puede rastrear esta URL (path + query)? */
export function robotsAllows(r: Robots, url: string): boolean {
  let target: string;
  try {
    const u = new URL(url);
    target = u.pathname + u.search;
  } catch {
    target = url;
  }
  // precedencia: la regla que coincide con más caracteres; en empate gana Allow
  let bestAllow = -1, bestDis = -1;
  for (const a of r.allow) if (ruleRe(a).test(target)) bestAllow = Math.max(bestAllow, a.length);
  for (const d of r.disallow) if (ruleRe(d).test(target)) bestDis = Math.max(bestDis, d.length);
  return bestDis < 0 || bestAllow >= bestDis;
}

/** `maxSitemaps`/`timeoutMs` permiten una lectura rápida (sugerencias en vivo) sin cambiar el uso del crawler. */
export async function fetchSitemapUrls(sitemaps: string[], max = 20000, o: { maxSitemaps?: number; timeoutMs?: number } = {}): Promise<string[]> {
  const { maxSitemaps = 200, timeoutMs = 30000 } = o;
  const urls = new Set<string>();
  const queue = [...sitemaps];
  const visited = new Set<string>();
  while (queue.length && urls.size < max && visited.size < maxSitemaps) {
    const sm = queue.shift()!;
    if (visited.has(sm)) continue;
    visited.add(sm);
    try {
      const { res } = await safeFetch(sm, { headers: { "User-Agent": env.userAgent }, timeoutMs });
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
