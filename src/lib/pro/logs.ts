import pLimit from "p-limit";
/**
 * Apache/Nginx combined logs. No se guarda ninguna IP, query string ni línea cruda. Si se pasa `botIps`, se anotan
 * en memoria las IP de los bots declarados (con su cantidad de peticiones) solo para verificarlos por DNS.
 */
export function parseServerLogs(input: string, botIps?: Map<string, Map<string, number>>) {
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
      /^(\S+) \S+ \S+ \[([^\]]+)\] "(?:GET|POST|HEAD|PUT|PATCH|DELETE|OPTIONS) ([^ ]+) HTTP\/[^\"]+" (\d{3}) (?:\d+|-)(?: "[^"]*" "([^"]*)")?/,
    );
    if (!m) {
      invalid++;
      continue;
    }
    parsed++;
    const status = Number(m[4]);
    statuses[status] = (statuses[status] ?? 0) + 1;
    let path: string;
    try {
      path = new URL(m[3], "https://logs.invalid").pathname;
    } catch {
      invalid++;
      continue;
    }
    const bot =
      /googlebot|bingbot|applebot|yandex|baiduspider|duckduckbot|slurp|gptbot|claudebot/i
        .exec(m[5] ?? "")?.[0]
        .toLowerCase();
    if (bot) {
      bots[bot] = (bots[bot] ?? 0) + 1;
      if (botIps) {
        const ips = botIps.get(bot) ?? new Map<string, number>();
        ips.set(m[1], (ips.get(m[1]) ?? 0) + 1);
        botIps.set(bot, ips);
      }
    }
    const u = urls.get(path) ?? { requests: 0, errors: 0, botRequests: 0 };
    u.requests++;
    if (status >= 400) u.errors++;
    if (bot) u.botRequests++;
    urls.set(path, u);
    if (
      bot &&
      (status >= 400 ||
        /\/(cart|checkout|account|search)(\/|$)/.test(path) ||
        m[3].includes("?"))
    )
      wasted++;
    const dt = m[2].replace(/^(\d+)\/(\w+)\/(\d+):/, "$2 $1 $3 ");
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
      "Bot declarado por user-agent; la verificación por DNS inverso y directo se agrega al subir el archivo",
    wasted,
    firstAt,
    lastAt,
    topUrls: [...urls]
      .map(([path, v]) => ({ path, ...v }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 1000),
  };
}

/** Dominios a los que resuelven las IP reales de cada buscador (documentación de Google, Bing y Apple). */
const BOT_DOMAINS: Record<string, RegExp> = {
  googlebot: /\.(googlebot|google)\.com$/i,
  bingbot: /\.search\.msn\.com$/i,
  applebot: /\.applebot\.apple\.com$/i,
};
export type Resolver = { reverse: (ip: string) => Promise<string[]>; lookup: (host: string) => Promise<string[]> };
export type BotVerification = Record<string, { ips: number; checked: number; verified: number; fake: number; verifiedRequests: number; fakeRequests: number; note?: string }>;

/**
 * Verifica bots por DNS: la IP debe resolver (inverso) a un dominio del buscador y ese nombre debe resolver
 * (directo) a la misma IP. Un user-agent «Googlebot» desde otra IP es un impostor. Hasta `maxIps` IP en total,
 * priorizando las que más peticiones hicieron. Las IP no se guardan: solo los conteos.
 */
export async function verifyBots(botIps: Map<string, Map<string, number>>, resolver: Resolver, maxIps = 200, concurrency = 20): Promise<BotVerification> {
  const out: BotVerification = {};
  const jobs: { bot: string; ip: string; requests: number; rule: RegExp }[] = [];
  for (const [bot, ips] of botIps) {
    const rule = BOT_DOMAINS[bot];
    out[bot] = { ips: ips.size, checked: 0, verified: 0, fake: 0, verifiedRequests: 0, fakeRequests: 0 };
    if (!rule) {
      out[bot].note = "Este bot no publica un dominio verificable por DNS: se cuenta como declarado";
      continue;
    }
    for (const [ip, requests] of ips) jobs.push({ bot, ip, requests, rule });
  }
  // las IP con más peticiones primero: son las que pesan en el resumen
  const picked = jobs.sort((x, y) => y.requests - x.requests).slice(0, maxIps);
  const limit = pLimit(concurrency);
  await Promise.all(
    picked.map((j) =>
      limit(async () => {
        let ok = false;
        try {
          const host = (await resolver.reverse(j.ip)).find((n) => j.rule.test(n));
          ok = Boolean(host && (await resolver.lookup(host)).includes(j.ip));
        } catch {
          ok = false;
        }
        const r = out[j.bot];
        r.checked++;
        if (ok) {
          r.verified++;
          r.verifiedRequests += j.requests;
        } else {
          r.fake++;
          r.fakeRequests += j.requests;
        }
      }),
    ),
  );
  for (const r of Object.values(out)) if (!r.note && r.checked < r.ips) r.note = `Se verificaron ${r.checked} de ${r.ips} IP (las de más peticiones)`;
  return out;
}

/** Resolver real con timeout por consulta. */
export function dnsResolver(timeoutMs = 3000): Resolver {
  const withTimeout = <T,>(p: Promise<T>) => Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error("timeout DNS")), timeoutMs))]);
  return {
    reverse: async (ip) => withTimeout((await import("node:dns/promises")).reverse(ip)),
    lookup: async (host) => withTimeout((await import("node:dns/promises")).lookup(host, { all: true })).then((r) => r.map((x) => x.address)),
  };
}
