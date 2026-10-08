import dns from "node:dns";
import net from "node:net";
import { Agent, fetch as ufetch, type RequestInit as URequestInit, type Response as UResponse } from "undici";

/**
 * Protección SSRF para todo fetch hacia URLs que vienen del usuario o de páginas crawleadas.
 *
 * - Solo http/https.
 * - Bloquea hostnames internos (servicios del compose, localhost, nombres sin punto).
 * - Bloquea IPs literales privadas/loopback/link-local/etc.
 * - Para hostnames, la IP se valida dentro del `lookup` del socket: la misma resolución que
 *   se valida es la que se usa para conectar (sin ventana de DNS rebinding).
 * - Redirects manuales: cada salto se vuelve a validar.
 */

export class SsrfError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "SsrfError";
  }
}

const COMPOSE_HOSTS = ["db", "web", "worker", "embeddings", "browser", "migrate", "localhost"];
const extraHosts = () => (process.env.SSRF_BLOCK_HOSTS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

function v4ToInt(ip: string) {
  return ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}
const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];
function blockedV4(ip: string) {
  const n = v4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => (n & (bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0)) >>> 0 === v4ToInt(base));
}

function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = v4ToInt(v4[1]);
    s = s.replace(v4[1], `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`);
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const fill = s.includes("::") ? 8 - h.length - t.length : 0;
  const parts = [...h, ...new Array(Math.max(0, fill)).fill("0"), ...t].map((x) => parseInt(x || "0", 16));
  return parts.length === 8 && parts.every((x) => x >= 0 && x <= 0xffff) ? parts : null;
}

function blockedV6(ip: string) {
  const p = expandV6(ip);
  if (!p) return true;
  if (p.every((x) => x === 0)) return true; // ::
  if (p.slice(0, 7).every((x) => x === 0) && p[7] === 1) return true; // ::1
  if ((p[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((p[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((p[0] & 0xff00) === 0xff00) return true; // multicast
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible y NAT64 (64:ff9b::/96): validar la IPv4 embebida
  const embedded = `${p[6] >> 8}.${p[6] & 255}.${p[7] >> 8}.${p[7] & 255}`;
  if (p.slice(0, 5).every((x) => x === 0) && (p[5] === 0xffff || p[5] === 0)) return blockedV4(embedded);
  if (p[0] === 0x64 && p[1] === 0xff9b) return blockedV4(embedded);
  if (p[0] === 0x2001 && p[1] === 0x0db8) return true; // documentación
  // 6to4 (2002:AABB:CCDD::): la IPv4 va en los grupos 2 y 3
  if (p[0] === 0x2002) return blockedV4(`${p[1] >> 8}.${p[1] & 255}.${p[2] >> 8}.${p[2] & 255}`);
  // Teredo (2001:0::/32): la IPv4 del cliente va invertida en el último grupo
  if (p[0] === 0x2001 && p[1] === 0) return blockedV4(`${(p[6] >> 8) ^ 255}.${(p[6] & 255) ^ 255}.${(p[7] >> 8) ^ 255}.${(p[7] & 255) ^ 255}`);
  return false;
}

export function isBlockedIp(ip: string) {
  const fam = net.isIP(ip.replace(/^\[|\]$/g, ""));
  if (fam === 4) return blockedV4(ip);
  if (fam === 6) return blockedV6(ip);
  return true;
}

export function isBlockedHostname(host: string) {
  const h = host.toLowerCase().replace(/\.$/, "");
  if ([...COMPOSE_HOSTS, ...extraHosts()].includes(h)) return true;
  if (h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (!net.isIP(h.replace(/^\[|\]$/g, "")) && !h.includes(".")) return true; // nombres de servicio sin dominio
  return false;
}

/** Validación estática de la URL (protocolo, hostname, IP literal). */
export function assertUrlAllowed(raw: string | URL): URL {
  let u: URL;
  try {
    u = new URL(String(raw));
  } catch {
    throw new SsrfError(`URL inválida: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new SsrfError(`protocolo no permitido: ${u.protocol}`);
  if (u.username || u.password) throw new SsrfError("credenciales en URL no permitidas");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new SsrfError(`IP bloqueada: ${host}`);
  } else if (isBlockedHostname(host)) {
    throw new SsrfError(`host bloqueado: ${host}`);
  }
  return u;
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
const defaultResolver: Resolver = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/** `lookup` para sockets: resuelve, rechaza si alguna IP es privada y entrega solo IPs validadas. */
export function makeSafeLookup(resolve: Resolver = defaultResolver) {
  return (hostname: string, options: dns.LookupOptions | number | LookupCb, cb?: LookupCb) => {
    const callback = (typeof options === "function" ? options : cb) as LookupCb;
    const opts = (typeof options === "object" ? options : {}) as dns.LookupOptions;
    (async () => {
      if (isBlockedHostname(hostname)) throw new SsrfError(`host bloqueado: ${hostname}`);
      const all = await resolve(hostname);
      if (!all.length) throw new SsrfError(`sin resolución: ${hostname}`);
      const bad = all.find((a) => isBlockedIp(a.address));
      if (bad) {
        // 0.0.0.0 / :: suele ser un filtro DNS del servidor (sinkhole), no un sitio interno
        if (bad.address === "0.0.0.0" || bad.address === "::") throw new SsrfError(`el DNS del servidor devuelve ${bad.address} para ${hostname} (bloqueado por un filtro DNS)`);
        throw new SsrfError(`${hostname} resuelve a una IP privada o reservada (${bad.address})`);
      }
      const wanted = opts.family === 4 || opts.family === 6 ? all.filter((a) => a.family === opts.family) : all;
      return wanted.length ? wanted : all;
    })().then(
      (addrs) => (opts.all ? callback(null, addrs) : callback(null, addrs[0].address, addrs[0].family)),
      // solo los bloqueos son SSRF; un fallo de DNS (ENOTFOUND, EAI_AGAIN) sigue siendo un fallo de DNS
      (e) => callback(e instanceof SsrfError ? Object.assign(e, { code: "ESSRF" }) : (e as NodeJS.ErrnoException), "", 0)
    );
  };
}

export function makeSafeAgent(resolve?: Resolver) {
  return new Agent({ connect: { lookup: makeSafeLookup(resolve) as any, timeout: 15000 }, headersTimeout: 30000, bodyTimeout: 60000 });
}

let shared: Agent | null = null;
const sharedAgent = () => (shared ??= makeSafeAgent());

export type SafeResponse = { res: UResponse; finalUrl: string; redirects: { url: string; status: number }[] };

/**
 * fetch con validación SSRF en cada salto. Devuelve la respuesta final y la cadena de redirects.
 * `fetchImpl`/`agent` se pueden inyectar en tests.
 */
export async function safeFetch(
  url: string,
  init: URequestInit & { timeoutMs?: number; maxRedirects?: number; agent?: Agent; fetchImpl?: typeof ufetch } = {}
): Promise<SafeResponse> {
  const { timeoutMs = 25000, maxRedirects = 10, agent, fetchImpl = ufetch, ...rest } = init;
  const redirects: { url: string; status: number }[] = [];
  let cur = assertUrlAllowed(url).toString();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: UResponse;
    try {
      res = await fetchImpl(cur, { ...rest, redirect: "manual", signal: ctrl.signal, dispatcher: agent ?? sharedAgent() });
    } catch (e: any) {
      const cause = e?.cause;
      if (cause instanceof SsrfError || cause?.code === "ESSRF") throw new SsrfError(cause.message);
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      redirects.push({ url: cur, status: res.status });
      await res.body?.cancel().catch(() => {});
      cur = assertUrlAllowed(new URL(loc, cur)).toString();
      continue;
    }
    return { res, finalUrl: cur, redirects };
  }
  throw new Error(`demasiados redirects desde ${url}`);
}
