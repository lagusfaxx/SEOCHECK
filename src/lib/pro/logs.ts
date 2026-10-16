/** Apache/Nginx combined logs. No IP, query string or raw line is retained. Bot identity is only claimed by UA. */
export function parseServerLogs(input: string) {
  const statuses: Record<string, number> = {},
    bots: Record<string, number> = {},
    urls = new Map<
      string,
      { requests: number; errors: number; botRequests: number }
    >();
  let lines = 0,
    parsed = 0,
    invalid = 0,
    wasted = 0;
  let firstAt: string | null = null,
    lastAt: string | null = null;
  for (const line of input.split(/\r?\n/)) {
    if (!line.trim()) continue;
    lines++;
    const m = line.match(
      /^\S+ \S+ \S+ \[([^\]]+)\] "(?:GET|POST|HEAD|PUT|PATCH|DELETE|OPTIONS) ([^ ]+) HTTP\/[^\"]+" (\d{3}) (?:\d+|-)(?: "[^"]*" "([^"]*)")?/,
    );
    if (!m) {
      invalid++;
      continue;
    }
    parsed++;
    const status = Number(m[3]);
    statuses[status] = (statuses[status] ?? 0) + 1;
    let path: string;
    try {
      path = new URL(m[2], "https://logs.invalid").pathname;
    } catch {
      invalid++;
      continue;
    }
    const bot =
      /googlebot|bingbot|applebot|yandex|baiduspider|duckduckbot|slurp|gptbot|claudebot/i
        .exec(m[4] ?? "")?.[0]
        .toLowerCase();
    if (bot) bots[bot] = (bots[bot] ?? 0) + 1;
    const u = urls.get(path) ?? { requests: 0, errors: 0, botRequests: 0 };
    u.requests++;
    if (status >= 400) u.errors++;
    if (bot) u.botRequests++;
    urls.set(path, u);
    if (
      bot &&
      (status >= 400 ||
        /\/(cart|checkout|account|search)(\/|$)/.test(path) ||
        m[2].includes("?"))
    )
      wasted++;
    const dt = m[1].replace(/^(\d+)\/(\w+)\/(\d+):/, "$2 $1 $3 ");
    const d = new Date(dt);
    if (Number.isFinite(d.getTime())) {
      const t = d.toISOString();
      if (!firstAt || t < firstAt) firstAt = t;
      if (!lastAt || t > lastAt) lastAt = t;
    }
  }
  return {
    lines,
    parsed,
    invalid,
    statuses,
    bots,
    verified: false,
    identityNote:
      "Bot declarado por user-agent; no se verificó DNS inverso y directo",
    wasted,
    firstAt,
    lastAt,
    topUrls: [...urls]
      .map(([path, v]) => ({ path, ...v }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 1000),
  };
}
