import { load } from "cheerio";
import { safeFetch } from "../net/ssrf";
import { env } from "../env";
export type SitemapEntry = {
  url: string;
  lastmod: string | null;
  sitemap: string;
};
export function parseSitemap(xml: string, source: string) {
  const $ = load(xml, { xmlMode: true }),
    index = $("sitemapindex").length > 0;
  const entries: SitemapEntry[] = [],
    children: string[] = [],
    invalid: string[] = [];
  $(index ? "sitemap" : "url").each((_, el) => {
    const raw = $(el).find("loc").first().text().trim();
    try {
      const u = new URL(raw);
      if (!["http:", "https:"].includes(u.protocol)) throw new Error();
      if (index) children.push(u.href);
      else {
        const d = $(el).find("lastmod").first().text().trim(),
          valid = d && Number.isFinite(new Date(d).getTime());
        entries.push({
          url: u.href,
          lastmod: valid ? new Date(d).toISOString() : null,
          sitemap: source,
        });
        if (d && !valid) invalid.push(`lastmod inválido en ${u.href}`);
      }
    } catch {
      invalid.push(raw.slice(0, 300));
    }
  });
  return { entries, children, invalid };
}
export async function fetchSitemapEvidence(
  sitemaps: string[],
  max = 20000,
  o: { maxSitemaps?: number; timeoutMs?: number; userAgent?: string } = {},
) {
  const entries = new Map<string, SitemapEntry>(),
    queue = [...sitemaps],
    visited = new Set<string>(),
    errors: { url: string; error: string }[] = [],
    invalid: string[] = [];
  while (
    queue.length &&
    entries.size < max &&
    visited.size < (o.maxSitemaps ?? 200)
  ) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      const { res } = await safeFetch(url, {
        headers: { "User-Agent": o.userAgent ?? env.userAgent },
        timeoutMs: o.timeoutMs ?? 30000,
      });
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`HTTP ${res.status}`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > 10 * 1024 * 1024)
        throw new Error("Sitemap supera 10 MiB");
      const xml = url.endsWith(".gz")
        ? (await import("node:zlib"))
            .gunzipSync(buffer, { maxOutputLength: 10 * 1024 * 1024 })
            .toString("utf8")
        : buffer.toString("utf8");
      const parsed = parseSitemap(xml, url);
      invalid.push(...parsed.invalid);
      queue.push(...parsed.children.slice(0, 200));
      for (const e of parsed.entries) {
        if (entries.size >= max) break;
        entries.set(e.url, e);
      }
    } catch (e) {
      errors.push({ url, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return {
    entries: [...entries.values()],
    errors,
    invalid: invalid.slice(0, 1000),
    visited: visited.size,
    truncated: queue.length > 0 || entries.size >= max,
  };
}
